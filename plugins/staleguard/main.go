package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"time"
)

// Config holds StaleGuard plugin configuration
type Config struct {
	ServiceURL string // URL of StaleGuard service, e.g. http://localhost:3001
	TimeoutMs  int    // HTTP timeout in ms (default 2000)
	BasicMode  bool   // If true, use regex extraction only (no service call)
	ApiKey     string // Optional API key for service auth
}

// Claim represents a detected time-sensitive claim
type Claim struct {
	Text     string  `json:"text"`
	Category string  `json:"category"`
	Value    string  `json:"extractedValue"`
	Score    float64 `json:"likelihood"`
}

// ServiceRequest sent to the StaleGuard Node service
type ServiceRequest struct {
	Text      string `json:"text"`
	RequestID string `json:"requestId"`
	Model     string `json:"model"`
	Timestamp int64  `json:"timestamp"`
}

// ServiceResponse from the StaleGuard Node service
type ServiceResponse struct {
	OverallScore float64 `json:"overallScore"`
	StaleCount   int     `json:"staleCount"`
	TotalClaims  int     `json:"totalClaims"`
	Claims       []Claim `json:"claims"`
	ProcessingMs int     `json:"processingMs"`
}

// StaleGuardPlugin is the main plugin struct
type StaleGuardPlugin struct {
	config Config
	logger *log.Logger
}

// Regex patterns for basic mode claim extraction
var (
	versionRe = regexp.MustCompile(`v\d+\.\d+(?:\.\d+)?`)
	priceRe   = regexp.MustCompile(`\$\d[\d,]*(?:\.\d{2})?`)
	dateRe    = regexp.MustCompile(`20\d{2}`)
	staleRe   = regexp.MustCompile(`(?i)\b(latest|current|as of|updated|recent)\b`)
)

func (p *StaleGuardPlugin) GetName() string { return "staleguard" }

func (p *StaleGuardPlugin) Cleanup() error { return nil }

func (p *StaleGuardPlugin) PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error {
	return nil
}

func (p *StaleGuardPlugin) PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error) {
	return req, nil, nil
}

func (p *StaleGuardPlugin) PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error) {
	if resp == nil || resp.ChatResponse == nil {
		return resp, e, nil
	}
	if len(resp.ChatResponse.Choices) == 0 {
		return resp, e, nil
	}
	choice := resp.ChatResponse.Choices[0]
	if choice.ChatNonStreamResponseChoice == nil || choice.Message == nil {
		return resp, e, nil
	}
	content := choice.Message.Content
	if content == nil || content.ContentStr == nil {
		return resp, e, nil
	}
	text := *content.ContentStr
	start := time.Now()

	if p.config.BasicMode || p.config.ServiceURL == "" {
		return p.basicMode(resp, text, start)
	}
	return p.serviceMode(ctx, resp, text, start)
}

func (p *StaleGuardPlugin) basicMode(resp *BifrostResponse, text string, start time.Time) (*BifrostResponse, *BifrostError, error) {
	claims := extractBasicClaims(text)
	staleCount := 0
	for _, c := range claims {
		if c.Score > 0.5 {
			staleCount++
		}
	}
	score := 0.8
	if len(claims) > 0 {
		score = 1.0 - (float64(staleCount)/float64(len(claims))*0.6)
	}
	latency := time.Since(start).Milliseconds()

	p.logHeader("X-StaleGuard-Score", fmt.Sprintf("%.2f", score))
	p.logHeader("X-StaleGuard-Stale", strconv.Itoa(staleCount))
	p.logHeader("X-StaleGuard-Latency", fmt.Sprintf("%dms", latency))
	p.logHeader("X-StaleGuard-Mode", "basic")

	if resp.ExtraHeaders == nil {
		resp.ExtraHeaders = make(map[string]string)
	}
	resp.ExtraHeaders["X-StaleGuard-Score"] = fmt.Sprintf("%.2f", score)
	resp.ExtraHeaders["X-StaleGuard-Stale"] = strconv.Itoa(staleCount)
	resp.ExtraHeaders["X-StaleGuard-Latency"] = fmt.Sprintf("%dms", latency)
	resp.ExtraHeaders["X-StaleGuard-Mode"] = "basic"

	if staleCount > 0 {
		note := fmt.Sprintf("\n---\n[StaleGuard] Score: %.2f | %d potentially stale of %d claims (basic mode)\n", score, staleCount, len(claims))
		updated := text + note
		resp.ChatResponse.Choices[0].Message.Content.ContentStr = &updated
	}
	return resp, nil, nil
}

func (p *StaleGuardPlugin) serviceMode(ctx *BifrostContext, resp *BifrostResponse, text string, start time.Time) (*BifrostResponse, *BifrostError, error) {
	timeoutMs := p.config.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = 2000
	}
	reqCtx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	requestID := ""
	if ctx != nil {
		requestID = ctx.RequestID
	}

	payload := ServiceRequest{
		Text:      text,
		RequestID: requestID,
		Model:     resp.ChatResponse.Model,
		Timestamp: time.Now().Unix(),
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, p.config.ServiceURL+"/api/check", bytes.NewReader(body))
	if err != nil {
		p.logger.Printf("[StaleGuard] FAIL OPEN: request creation error: %v", err)
		return p.failOpen(resp)
	}
	req.Header.Set("Content-Type", "application/json")
	if p.config.ApiKey != "" {
		req.Header.Set("X-StaleGuard-Key", p.config.ApiKey)
	}

	httpResp, err := http.DefaultClient.Do(req)
	if err != nil {
		p.logger.Printf("[StaleGuard] FAIL OPEN: service unreachable: %v", err)
		return p.failOpen(resp)
	}
	defer httpResp.Body.Close()

	var svcResp ServiceResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&svcResp); err != nil {
		p.logger.Printf("[StaleGuard] FAIL OPEN: decode error: %v", err)
		return p.failOpen(resp)
	}

	latency := time.Since(start).Milliseconds()
	if resp.ExtraHeaders == nil {
		resp.ExtraHeaders = make(map[string]string)
	}
	resp.ExtraHeaders["X-StaleGuard-Score"] = fmt.Sprintf("%.2f", svcResp.OverallScore)
	resp.ExtraHeaders["X-StaleGuard-Stale"] = strconv.Itoa(svcResp.StaleCount)
	resp.ExtraHeaders["X-StaleGuard-Latency"] = fmt.Sprintf("%dms", latency)
	resp.ExtraHeaders["X-StaleGuard-Mode"] = "service"
	p.logHeader("X-StaleGuard-Score", fmt.Sprintf("%.2f", svcResp.OverallScore))
	p.logHeader("X-StaleGuard-Mode", "service")

	if svcResp.StaleCount > 0 {
		note := fmt.Sprintf("\n---\n[StaleGuard] Score: %.2f | %d stale of %d claims verified\n", svcResp.OverallScore, svcResp.StaleCount, svcResp.TotalClaims)
		updated := text + note
		resp.ChatResponse.Choices[0].Message.Content.ContentStr = &updated
	}
	return resp, nil, nil
}

func (p *StaleGuardPlugin) failOpen(resp *BifrostResponse) (*BifrostResponse, *BifrostError, error) {
	if resp.ExtraHeaders == nil {
		resp.ExtraHeaders = make(map[string]string)
	}
	resp.ExtraHeaders["X-StaleGuard-Mode"] = "bypass"
	p.logHeader("X-StaleGuard-Mode", "bypass")
	return resp, nil, nil
}

func (p *StaleGuardPlugin) logHeader(key, value string) {
	p.logger.Printf("[StaleGuard-Header] %s: %s", key, value)
}

// extractBasicClaims runs regex heuristics to find time-sensitive claims
func extractBasicClaims(text string) []Claim {
	var claims []Claim
	for _, m := range versionRe.FindAllString(text, -1) {
		claims = append(claims, Claim{Text: m, Category: "version", Value: m, Score: 0.85})
	}
	for _, m := range priceRe.FindAllString(text, -1) {
		claims = append(claims, Claim{Text: m, Category: "pricing", Value: m, Score: 0.9})
	}
	for _, m := range dateRe.FindAllString(text, -1) {
		claims = append(claims, Claim{Text: m, Category: "date", Value: m, Score: 0.6})
	}
	if staleRe.MatchString(text) {
		claims = append(claims, Claim{Text: "staleness_indicator", Category: "fact", Value: "current", Score: 0.55})
	}
	return claims
}

// InitPlugin is called by Bifrost when loading the .so file
func InitPlugin(config map[string]interface{}) (interface{}, error) {
	cfg := Config{TimeoutMs: 2000}
	if v, ok := config["service_url"].(string); ok {
		cfg.ServiceURL = v
	}
	if v, ok := config["timeout_ms"].(float64); ok {
		cfg.TimeoutMs = int(v)
	}
	if v, ok := config["basic_mode"].(bool); ok {
		cfg.BasicMode = v
	}
	// Never log config["api_key"]
	if v, ok := config["api_key"].(string); ok {
		cfg.ApiKey = v
	}
	return &StaleGuardPlugin{
		config: cfg,
		logger: log.New(os.Stderr, "", log.LstdFlags),
	}, nil
}

// PluginInstance is the exported symbol for Bifrost dynamic plugin loading
var PluginInstance = &StaleGuardPlugin{
	config: Config{TimeoutMs: 2000, BasicMode: true},
	logger: log.New(os.Stderr, "", log.LstdFlags),
}

func main() {
	// Not used when compiled as plugin; placeholder for go build
	fmt.Println("StaleGuard plugin — build with: go build -buildmode=plugin -o staleguard.so")
}
