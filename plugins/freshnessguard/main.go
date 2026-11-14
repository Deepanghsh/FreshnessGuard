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
	"strings"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// ─────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────

// PluginConfig holds all FreshnessGuard plugin settings.
// Set via the Bifrost config.json "config" block for this plugin.
type PluginConfig struct {
	// ServiceURL is the URL of the FreshnessGuard Node service.
	// Leave empty to run in BasicMode only.
	ServiceURL string `json:"service_url"`

	// TimeoutMs is the HTTP timeout for service calls (default 2000ms).
	// If the service does not respond within this window, the plugin FAILS OPEN.
	TimeoutMs int `json:"timeout_ms"`

	// BasicMode forces regex-only extraction — no service call.
	// Useful when running without the Node service (e.g., local dev).
	BasicMode bool `json:"basic_mode"`

	// ScoreThreshold: claims with a freshness score above this are suppressed
	// from the correction note. Default 0.75 (only clearly stale claims show).
	ScoreThreshold float64 `json:"score_threshold"`

	// ApiKey is an optional Bearer token for the service endpoint.
	// Never logged.
	ApiKey string `json:"api_key"`

	// InjectNote controls whether a [FreshnessGuard] summary note is appended
	// to the response text when stale claims are found (default true).
	InjectNote bool `json:"inject_note"`
}

// ─────────────────────────────────────────────────────────
// Wire types (service request / response)
// ─────────────────────────────────────────────────────────

// ServiceRequest is the payload sent to POST /api/check.
type ServiceRequest struct {
	Text      string `json:"text"`
	RequestID string `json:"requestId"`
	Model     string `json:"model"`
	Timestamp int64  `json:"timestamp"`
}

// ClaimResult is a single verified claim returned by the service.
type ClaimResult struct {
	Text           string  `json:"text"`
	Category       string  `json:"category"`
	ExtractedValue string  `json:"extractedValue"`
	Verdict        string  `json:"verdict"` // "current" | "stale" | "unverified"
	LiveValue      string  `json:"liveValue,omitempty"`
	Score          float64 `json:"score"`
	SourceURL      string  `json:"sourceUrl,omitempty"`
}

// ServiceResponse is returned by POST /api/check.
type ServiceResponse struct {
	OverallScore    float64       `json:"overallScore"`
	StaleCount      int           `json:"staleCount"`
	TotalClaims     int           `json:"totalClaims"`
	Claims          []ClaimResult `json:"claims"`
	ProcessingMs    int           `json:"processingMs"`
	CorrectedAnswer string        `json:"correctedAnswer,omitempty"`
}

// BasicClaim is a claim found by local regex.
type BasicClaim struct {
	Text     string
	Category string
	Value    string
	Score    float64 // staleness likelihood (not freshness score)
}

// ─────────────────────────────────────────────────────────
// Regex patterns
// ─────────────────────────────────────────────────────────

var (
	reVersion = regexp.MustCompile(`\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9]+)?\b`)
	rePrice   = regexp.MustCompile(`\$\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:per|/)\s*(?:month|year|mo|yr|user|seat|request|token|k tokens))?`)
	reYear    = regexp.MustCompile(`\b(202[0-9]|203[0-9])\b`)
	reStale   = regexp.MustCompile(`(?i)\b(latest|current|as of|updated|recent|now supports|currently|at the time of writing|at present|today)\b`)
	reLaw     = regexp.MustCompile(`(?i)\b(regulation|act|law|directive|gdpr|ccpa|hipaa|sox|basel|dodd.frank)\b`)
	reCEO     = regexp.MustCompile(`(?i)\b(ceo|cto|coo|cfo|president|founder|chairm[ae]n|director)\b.{0,60}`)
)

// ─────────────────────────────────────────────────────────
// Plugin struct
// ─────────────────────────────────────────────────────────

// FreshnessGuardPlugin implements schemas.LLMPlugin (locally stubbed).
type FreshnessGuardPlugin struct {
	cfg    PluginConfig
	logger *log.Logger
	client *http.Client
}

func newPlugin(cfg PluginConfig) *FreshnessGuardPlugin {
	if cfg.TimeoutMs <= 0 {
		cfg.TimeoutMs = 2000
	}
	if cfg.ScoreThreshold <= 0 {
		cfg.ScoreThreshold = 0.75
	}
	return &FreshnessGuardPlugin{
		cfg:    cfg,
		logger: log.New(os.Stderr, "[FreshnessGuard] ", log.LstdFlags|log.Lmsgprefix),
		client: &http.Client{},
	}
}

// ─────────────────────────────────────────────────────────
// Bifrost response metadata passed from PostLLMHook to the HTTP header hook.
type freshnessGuardMetadataKey struct{}

var freshnessGuardMetadataContextKey freshnessGuardMetadataKey

type freshnessGuardMetadata struct {
	Score     string
	Stale     int
	LatencyMs int64
	Mode      string
}

// LLMPlugin interface implementation
// ─────────────────────────────────────────────────────────

func (p *FreshnessGuardPlugin) GetName() string { return "freshnessguard" }

func (p *FreshnessGuardPlugin) Cleanup() error { return nil }

func (p *FreshnessGuardPlugin) isBypass(ctx *BifrostContext) bool {
	if ctx == nil {
		return false
	}

	headers, _ := ctx.Value(schemas.BifrostContextKeyRequestHeaders).(map[string]string)
	for _, key := range []string{
		"x-bf-eh-freshnessguard-bypass",
		"freshnessguard-bypass",
		"x-freshnessguard-bypass",
		"bypass",
	} {
		value := strings.ToLower(strings.TrimSpace(headers[key]))
		if value == "true" || value == "1" {
			return true
		}
	}
	return false
}

func (p *FreshnessGuardPlugin) PreRequestHook(_ *BifrostContext, _ *BifrostRequest) error {
	return nil
}

func (p *FreshnessGuardPlugin) PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error) {
	if p.isBypass(ctx) {
		p.logger.Println("Internal recursion bypass detected in PreLLMHook — skipping inspection")
	}
	return req, nil, nil
}

// PostLLMHook is the main interception point.
// It is called after the LLM responds and before the response reaches the user.
func (p *FreshnessGuardPlugin) PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error) {
	// Guard against nil / empty responses
	if resp == nil || resp.ChatResponse == nil {
		return resp, e, nil
	}
	if len(resp.ChatResponse.Choices) == 0 {
		return resp, e, nil
	}

	// Internal recursion bypass check
	if p.isBypass(ctx) {
		p.logger.Println("Internal recursion bypass detected in PostLLMHook — passing through untouched")
		p.injectHeaders(ctx, "1.000", 0, 0, "bypass")
		return resp, e, nil
	}

	choice := &resp.ChatResponse.Choices[0]
	// Handle streaming chunks gracefully without crashing
	if choice.ChatNonStreamResponseChoice == nil || choice.Message == nil {
		p.logger.Println("Streaming response chunk or non-standard choice — passing through untouched")
		return resp, e, nil
	}
	content := choice.Message.Content
	if content == nil || content.ContentStr == nil {
		return resp, e, nil
	}

	text := *content.ContentStr
	start := time.Now()

	if p.cfg.BasicMode || p.cfg.ServiceURL == "" {
		return p.runBasicMode(ctx, resp, text, start)
	}
	return p.runServiceMode(ctx, resp, text, start)
}

// ─────────────────────────────────────────────────────────
// Basic Mode (regex, no network)
// ─────────────────────────────────────────────────────────

func (p *FreshnessGuardPlugin) runBasicMode(ctx *BifrostContext, resp *BifrostResponse, text string, start time.Time) (*BifrostResponse, *BifrostError, error) {
	claims := extractBasicClaims(text)

	staleCount := 0
	for _, c := range claims {
		if c.Score >= p.cfg.ScoreThreshold {
			staleCount++
		}
	}

	freshness := 1.0
	if len(claims) > 0 {
		freshness = 1.0 - (float64(staleCount)/float64(len(claims)))*0.6
	}

	latencyMs := time.Since(start).Milliseconds()
	p.injectHeaders(ctx, fmt.Sprintf("%.3f", freshness), staleCount, latencyMs, "basic")

	if staleCount > 0 && p.cfg.InjectNote {
		note := buildBasicNote(freshness, staleCount, len(claims), claims)
		updated := text + note
		resp.ChatResponse.Choices[0].Message.Content.ContentStr = &updated
	}
	return resp, nil, nil
}

func extractBasicClaims(text string) []BasicClaim {
	seen := map[string]bool{}
	var claims []BasicClaim

	add := func(val, cat string, score float64) {
		key := cat + ":" + val
		if !seen[key] {
			seen[key] = true
			claims = append(claims, BasicClaim{Text: val, Category: cat, Value: val, Score: score})
		}
	}

	for _, m := range reVersion.FindAllString(text, -1) {
		add(m, "version", 0.85)
	}
	for _, m := range rePrice.FindAllString(text, -1) {
		add(strings.TrimSpace(m), "pricing", 0.9)
	}
	for _, m := range reYear.FindAllString(text, -1) {
		add(m, "date", 0.65)
	}
	for _, m := range reLaw.FindAllString(text, -1) {
		add(strings.ToUpper(m), "law", 0.6)
	}
	for _, m := range reCEO.FindAllString(text, -1) {
		add(strings.TrimSpace(m), "leadership", 0.8)
	}
	if reStale.MatchString(text) {
		add("staleness_indicator", "fact", 0.55)
	}
	return claims
}

func buildBasicNote(freshness float64, staleCount, total int, claims []BasicClaim) string {
	var sb strings.Builder
	sb.WriteString("\n\n---\n")
	sb.WriteString(fmt.Sprintf("**[FreshnessGuard]** Freshness score: **%.0f%%** | %d of %d claims flagged as likely stale (basic mode — not verified against live sources).\n\n", freshness*100, staleCount, total))
	sb.WriteString("Flagged claims:\n")
	for _, c := range claims {
		if c.Score >= 0.75 {
			sb.WriteString(fmt.Sprintf("- `%s` (%s, staleness risk %.0f%%)\n", c.Value, c.Category, c.Score*100))
		}
	}
	sb.WriteString("\n> Run with the FreshnessGuard service for live Tavily verification.\n")
	return sb.String()
}

// ─────────────────────────────────────────────────────────
// Service Mode (calls Node service, FAIL OPEN)
// ─────────────────────────────────────────────────────────

func (p *FreshnessGuardPlugin) runServiceMode(ctx *BifrostContext, resp *BifrostResponse, text string, start time.Time) (*BifrostResponse, *BifrostError, error) {
	requestID := ""
	if ctx != nil {
		if value := ctx.Value(schemas.BifrostContextKeyRequestID); value != nil {
			requestID, _ = value.(string)
		}
	}

	payload := ServiceRequest{
		Text:      text,
		RequestID: requestID,
		Model:     resp.ChatResponse.Model,
		Timestamp: time.Now().Unix(),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		p.logger.Printf("FAIL OPEN: marshal error: %v", err)
		return p.failOpen(ctx, resp)
	}

	reqCtx, cancel := context.WithTimeout(context.Background(), time.Duration(p.cfg.TimeoutMs)*time.Millisecond)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, p.cfg.ServiceURL+"/api/check", bytes.NewReader(body))
	if err != nil {
		p.logger.Printf("FAIL OPEN: build request error: %v", err)
		return p.failOpen(ctx, resp)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if p.cfg.ApiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.cfg.ApiKey)
	}

	httpResp, err := p.client.Do(httpReq)
	if err != nil {
		p.logger.Printf("FAIL OPEN: service unreachable (%v)", err)
		return p.failOpen(ctx, resp)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode >= 500 {
		p.logger.Printf("FAIL OPEN: service returned HTTP %d", httpResp.StatusCode)
		return p.failOpen(ctx, resp)
	}

	var svcResp ServiceResponse
	if err := json.NewDecoder(httpResp.Body).Decode(&svcResp); err != nil {
		p.logger.Printf("FAIL OPEN: decode error: %v", err)
		return p.failOpen(ctx, resp)
	}

	latencyMs := time.Since(start).Milliseconds()
	p.injectHeaders(ctx, fmt.Sprintf("%.3f", svcResp.OverallScore), svcResp.StaleCount, latencyMs, "service")

	if svcResp.StaleCount > 0 && p.cfg.InjectNote {
		note := buildServiceNote(svcResp)
		var updated string
		if svcResp.CorrectedAnswer != "" {
			updated = svcResp.CorrectedAnswer + note
		} else {
			updated = text + note
		}
		resp.ChatResponse.Choices[0].Message.Content.ContentStr = &updated
	}
	return resp, nil, nil
}

func buildServiceNote(s ServiceResponse) string {
	var sb strings.Builder
	sb.WriteString("\n\n---\n")
	sb.WriteString(fmt.Sprintf("**[FreshnessGuard]** Freshness score: **%.0f%%** | %d of %d claims verified stale via Tavily.\n\n", s.OverallScore*100, s.StaleCount, s.TotalClaims))
	for _, c := range s.Claims {
		if c.Verdict == "stale" {
			sb.WriteString(fmt.Sprintf("- **%s** (`%s`) — was: `%s`, now: `%s`", c.Category, c.Text, c.ExtractedValue, c.LiveValue))
			if c.SourceURL != "" {
				sb.WriteString(fmt.Sprintf(" ([source](%s))", c.SourceURL))
			}
			sb.WriteString(fmt.Sprintf(" [score: %.2f]\n", c.Score))
		}
	}
	return sb.String()
}

func (p *FreshnessGuardPlugin) failOpen(ctx *BifrostContext, resp *BifrostResponse) (*BifrostResponse, *BifrostError, error) {
	p.injectHeaders(ctx, "1.000", 0, 0, "bypass")
	return resp, nil, nil
}

// ─────────────────────────────────────────────────────────
// Header injection
// ─────────────────────────────────────────────────────────

func (p *FreshnessGuardPlugin) injectHeaders(ctx *BifrostContext, score string, stale int, latencyMs int64, mode string) {
	if ctx != nil {
		ctx.SetValue(freshnessGuardMetadataContextKey, freshnessGuardMetadata{
			Score:     score,
			Stale:     stale,
			LatencyMs: latencyMs,
			Mode:      mode,
		})
	}

	// Log headers (never log keys or secrets).
	p.logger.Printf("Score=%s Stale=%d Latency=%dms Mode=%s", score, stale, latencyMs, mode)
}

// HTTPTransportResponseHeadersHook applies FreshnessGuard metadata to the
// actual HTTP response after Bifrost has finalized the response.
func HTTPTransportResponseHeadersHookImpl(
	ctx *schemas.BifrostContext,
	_ *schemas.HTTPRequest,
	resp *schemas.HTTPResponseMetadata,
) error {
	if ctx == nil || resp == nil {
		return nil
	}

	metadata, ok := ctx.Value(freshnessGuardMetadataContextKey).(freshnessGuardMetadata)
	if !ok {
		return nil
	}

	resp.SetHeader("X-FreshnessGuard-Score", metadata.Score)
	resp.SetHeader("X-FreshnessGuard-Stale", strconv.Itoa(metadata.Stale))
	resp.SetHeader("X-FreshnessGuard-Latency", fmt.Sprintf("%dms", metadata.LatencyMs))
	resp.SetHeader("X-FreshnessGuard-Mode", metadata.Mode)
	return nil
}

// ─────────────────────────────────────────────────────────
// Plugin init / export (for Bifrost dynamic loading)
// ─────────────────────────────────────────────────────────

var pluginInstance = newPlugin(PluginConfig{
	TimeoutMs:      2000,
	BasicMode:      true,
	ScoreThreshold: 0.75,
	InjectNote:     true,
})

// Init is the standard Bifrost plugin initialization entry point (Init(config any) error).
// It unmarshals the plugin configuration and initializes the plugin instance.
func Init(config any) error {
	cfg := PluginConfig{
		TimeoutMs:      2000,
		ScoreThreshold: 0.75,
		InjectNote:     true,
	}

	if m, ok := config.(map[string]interface{}); ok {
		if v, ok := m["service_url"].(string); ok {
			cfg.ServiceURL = v
		}
		if v, ok := m["timeout_ms"].(float64); ok {
			cfg.TimeoutMs = int(v)
		} else if v, ok := m["timeout_ms"].(int); ok {
			cfg.TimeoutMs = v
		}
		if v, ok := m["basic_mode"].(bool); ok {
			cfg.BasicMode = v
		}
		if v, ok := m["score_threshold"].(float64); ok {
			cfg.ScoreThreshold = v
		}
		if v, ok := m["inject_note"].(bool); ok {
			cfg.InjectNote = v
		} else if v, ok := m["append_note"].(bool); ok {
			cfg.InjectNote = v
		}
		if v, ok := m["api_key"].(string); ok {
			cfg.ApiKey = v
		}
	}
	pluginInstance = newPlugin(cfg)
	return nil
}

// Package-level exported hooks resolved by soloader.go symbol lookups
func GetName() string {
	return pluginInstance.GetName()
}

func Cleanup() error {
	return pluginInstance.Cleanup()
}

func PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error {
	return pluginInstance.PreRequestHook(ctx, req)
}

func PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error) {
	return pluginInstance.PreLLMHook(ctx, req)
}

func PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error) {
	return pluginInstance.PostLLMHook(ctx, resp, e)
}

func HTTPTransportResponseHeadersHook(
	ctx *schemas.BifrostContext,
	req *schemas.HTTPRequest,
	resp *schemas.HTTPResponseMetadata,
) error {
	return HTTPTransportResponseHeadersHookImpl(ctx, req, resp)
}

func main() {
	fmt.Fprintln(os.Stderr, "FreshnessGuard plugin binary.")
	fmt.Fprintln(os.Stderr, "Build as shared library with:")
	fmt.Fprintln(os.Stderr, "  go build -buildmode=plugin -o freshnessguard.so .")
	fmt.Fprintln(os.Stderr, "  (Linux / WSL / Docker only — not supported on Windows)")
}
