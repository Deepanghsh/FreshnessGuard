package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// ─── helpers ────────────────────────────────────────────

func testPlugin(basicMode bool, serviceURL string, timeoutMs int) *FreshnessGuardPlugin {
	return newPlugin(PluginConfig{
		BasicMode:      basicMode,
		ServiceURL:     serviceURL,
		TimeoutMs:      timeoutMs,
		ScoreThreshold: 0.75,
		InjectNote:     true,
	})
}

var testResponseHeaders map[string]string

func postLLMForTest(p *FreshnessGuardPlugin, ctx *BifrostContext, resp *BifrostResponse) (*BifrostResponse, *BifrostError, error) {
	if ctx == nil {
		ctx = schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	}
	got, bifrostErr, err := p.PostLLMHook(ctx, resp, nil)
	metadata := &schemas.HTTPResponseMetadata{}
	if hookErr := HTTPTransportResponseHeadersHook(ctx, nil, metadata); hookErr != nil && err == nil {
		err = hookErr
	}
	testResponseHeaders = metadata.Headers
	return got, bifrostErr, err
}

func makeResponse(text string) *BifrostResponse {
	s := text
	return &BifrostResponse{
		ChatResponse: &BifrostChatResponse{
			Model: "gpt-4o",
			Choices: []BifrostResponseChoice{
				{
					ChatNonStreamResponseChoice: &ChatNonStreamResponseChoice{
						Message: &ChatMessage{
							Role: "assistant",
							Content: &ChatMessageContent{
								ContentStr: &s,
							},
						},
					},
				},
			},
		},
	}
}

func getText(resp *BifrostResponse) string {
	if resp == nil || resp.ChatResponse == nil || len(resp.ChatResponse.Choices) == 0 {
		return ""
	}
	c := resp.ChatResponse.Choices[0].Message
	if c == nil || c.Content == nil || c.Content.ContentStr == nil {
		return ""
	}
	return *c.Content.ContentStr
}

// ─── basic mode tests ────────────────────────────────────

func TestExtractBasicClaims_Versions(t *testing.T) {
	text := "Use the SDK v2.1.0 or the new v3.0.0-beta release."
	claims := extractBasicClaims(text)
	versions := 0
	for _, c := range claims {
		if c.Category == "version" {
			versions++
		}
	}
	if versions < 2 {
		t.Errorf("expected >=2 version claims, got %d (claims: %+v)", versions, claims)
	}
}

func TestExtractBasicClaims_Prices(t *testing.T) {
	text := "The Pro plan is $29.99/month and Enterprise is $299 per year."
	claims := extractBasicClaims(text)
	prices := 0
	for _, c := range claims {
		if c.Category == "pricing" {
			prices++
		}
	}
	if prices < 1 {
		t.Errorf("expected >=1 price claim, got %d", prices)
	}
}

func TestExtractBasicClaims_Leadership(t *testing.T) {
	text := "The CEO of TechCorp is Jane Doe and the CTO is John Smith."
	claims := extractBasicClaims(text)
	leadership := 0
	for _, c := range claims {
		if c.Category == "leadership" {
			leadership++
		}
	}
	if leadership < 1 {
		t.Errorf("expected >=1 leadership claim, got %d (claims: %+v)", leadership, claims)
	}
}

func TestBasicMode_NoteAppended(t *testing.T) {
	text := "GPT-4 API v1.0 costs $0.03/token and is the latest model as of 2024."
	resp := makeResponse(text)
	p := testPlugin(true, "", 2000)

	got, err, _ := postLLMForTest(p, nil, resp)
	if err != nil {
		t.Fatalf("unexpected BifrostError: %v", err)
	}
	content := getText(got)
	if !strings.Contains(content, "[FreshnessGuard]") {
		t.Errorf("expected FreshnessGuard note in response, got:\n%s", content)
	}
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "basic" {
		t.Errorf("expected mode=basic, got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
}

func TestBasicMode_NoNoteForCleanText(t *testing.T) {
	text := "The capital of France is Paris."
	resp := makeResponse(text)
	p := testPlugin(true, "", 2000)

	got, _, _ := postLLMForTest(p, nil, resp)
	content := getText(got)
	if strings.Contains(content, "[FreshnessGuard]") {
		t.Errorf("did not expect a note for stable text, got:\n%s", content)
	}
}

// ─── fail-open tests ─────────────────────────────────────

func TestFailOpen_SlowService(t *testing.T) {
	// Server that sleeps 5 seconds — far beyond our 100ms timeout
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(5 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	originalText := "GPT-4 API v1.0 costs $0.03/token."
	resp := makeResponse(originalText)
	p := testPlugin(false, srv.URL, 100) // 100ms timeout

	got, bErr, err := postLLMForTest(p, nil, resp)
	if err != nil {
		t.Fatalf("plugin returned unexpected error: %v", err)
	}
	if bErr != nil {
		t.Fatalf("plugin returned unexpected BifrostError: %v", bErr)
	}
	if got == nil {
		t.Fatal("FAIL OPEN: response must not be nil")
	}
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "bypass" {
		t.Errorf("FAIL OPEN: expected mode=bypass, got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
	// Original text must be untouched
	if getText(got) != originalText {
		t.Errorf("FAIL OPEN: text modified; got:\n%s", getText(got))
	}
}

func TestFailOpen_ServiceDown(t *testing.T) {
	// No server listening on this port
	resp := makeResponse("Python 3.11 is the latest stable version.")
	p := testPlugin(false, "http://127.0.0.1:19999", 500)

	_, _, _ = postLLMForTest(p, nil, resp)
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "bypass" {
		t.Errorf("expected bypass when service is down, got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
}

func TestFailOpen_Service500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	resp := makeResponse("Python 3.11 is the latest stable version.")
	p := testPlugin(false, srv.URL, 2000)

	_, _, _ = postLLMForTest(p, nil, resp)
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "bypass" {
		t.Errorf("expected bypass for HTTP 500, got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
}

// ─── service mode tests ───────────────────────────────────

func TestServiceMode_StaleResponse(t *testing.T) {
	svcResp := ServiceResponse{
		OverallScore: 0.25,
		StaleCount:   2,
		TotalClaims:  3,
		Claims: []ClaimResult{
			{Text: "$0.03/token", Category: "pricing", ExtractedValue: "$0.03", Verdict: "stale", LiveValue: "$0.01", Score: 0.1, SourceURL: "https://openai.com/pricing"},
			{Text: "v1.0", Category: "version", ExtractedValue: "v1.0", Verdict: "stale", LiveValue: "v2.0", Score: 0.1, SourceURL: "https://platform.openai.com/docs"},
			{Text: "gpt-4", Category: "version", ExtractedValue: "gpt-4", Verdict: "current", Score: 0.9},
		},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/check" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(svcResp)
	}))
	defer srv.Close()

	resp := makeResponse("GPT-4 API v1.0 costs $0.03/token.")
	p := testPlugin(false, srv.URL, 2000)

	got, _, _ := postLLMForTest(p, nil, resp)
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "service" {
		t.Errorf("expected mode=service, got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
	if testResponseHeaders["X-FreshnessGuard-Score"] != "0.250" {
		t.Errorf("expected score=0.250, got %q", testResponseHeaders["X-FreshnessGuard-Score"])
	}
	if testResponseHeaders["X-FreshnessGuard-Stale"] != "2" {
		t.Errorf("expected stale=2, got %q", testResponseHeaders["X-FreshnessGuard-Stale"])
	}
	content := getText(got)
	if !strings.Contains(content, "[FreshnessGuard]") {
		t.Errorf("expected note in content; got:\n%s", content)
	}
	if !strings.Contains(content, "openai.com/pricing") {
		t.Errorf("expected source URL in content; got:\n%s", content)
	}
}

func TestServiceMode_AllCurrent(t *testing.T) {
	svcResp := ServiceResponse{OverallScore: 0.95, StaleCount: 0, TotalClaims: 2}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(svcResp)
	}))
	defer srv.Close()

	text := "React v18 is the current stable release."
	resp := makeResponse(text)
	p := testPlugin(false, srv.URL, 2000)

	got, _, _ := postLLMForTest(p, nil, resp)
	// No stale claims → no note appended
	if strings.Contains(getText(got), "[FreshnessGuard]") {
		t.Error("unexpected note when all claims are current")
	}
}

// ─── nil safety tests ─────────────────────────────────────

func TestNilResponse(t *testing.T) {
	p := testPlugin(true, "", 2000)
	got, _, err := postLLMForTest(p, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Fatal("expected nil response when input is nil")
	}
}

func TestNilChatResponse(t *testing.T) {
	p := testPlugin(true, "", 2000)
	resp := &BifrostResponse{ChatResponse: nil}
	got, _, _ := postLLMForTest(p, nil, resp)
	if got == nil {
		t.Fatal("expected non-nil response")
	}
}

func TestNilContent(t *testing.T) {
	p := testPlugin(true, "", 2000)
	resp := &BifrostResponse{
		ChatResponse: &BifrostChatResponse{
			Choices: []BifrostResponseChoice{
				{ChatNonStreamResponseChoice: &ChatNonStreamResponseChoice{
					Message: &ChatMessage{Role: "assistant", Content: nil},
				}},
			},
		},
	}
	// Must not panic
	got, _, _ := postLLMForTest(p, nil, resp)
	if got == nil {
		t.Fatal("expected non-nil response")
	}
}

func TestEmptyChoices(t *testing.T) {
	p := testPlugin(true, "", 2000)
	resp := &BifrostResponse{
		ChatResponse: &BifrostChatResponse{Choices: []BifrostResponseChoice{}},
	}
	got, _, _ := postLLMForTest(p, nil, resp)
	if got == nil {
		t.Fatal("expected non-nil response")
	}
}

// ─── headers test ─────────────────────────────────────────

func TestHeadersInjected(t *testing.T) {
	text := "React v18 costs $0 (open source) as of 2024."
	resp := makeResponse(text)
	p := testPlugin(true, "", 2000)
	p.logger = log.New(os.Stderr, "", 0) // suppress output

	_, _, _ = postLLMForTest(p, nil, resp)
	requiredHeaders := []string{
		"X-FreshnessGuard-Score",
		"X-FreshnessGuard-Stale",
		"X-FreshnessGuard-Latency",
		"X-FreshnessGuard-Mode",
	}
	for _, h := range requiredHeaders {
		if _, ok := testResponseHeaders[h]; !ok {
			t.Errorf("missing header: %s (all headers: %v)", h, testResponseHeaders)
		}
	}
}

// ─── GetName / Cleanup ────────────────────────────────────

func TestGetName(t *testing.T) {
	p := testPlugin(true, "", 2000)
	if p.GetName() != "freshnessguard" {
		t.Errorf("wrong name: %q", p.GetName())
	}
}

func TestCleanup(t *testing.T) {
	p := testPlugin(true, "", 2000)
	if err := p.Cleanup(); err != nil {
		t.Errorf("Cleanup() returned error: %v", err)
	}
}

// ─── InitPlugin ───────────────────────────────────────────

func TestInit(t *testing.T) {
	cfg := map[string]interface{}{
		"service_url":     "http://localhost:3001",
		"timeout_ms":      float64(3000),
		"basic_mode":      false,
		"score_threshold": float64(0.8),
		"inject_note":     true,
		"api_key":         "secret",
	}
	err := Init(cfg)
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	if GetName() != "freshnessguard" {
		t.Errorf("GetName() = %q; want 'freshnessguard'", GetName())
	}
	if pluginInstance.cfg.ServiceURL != "http://localhost:3001" {
		t.Errorf("service_url not set: %q", pluginInstance.cfg.ServiceURL)
	}
	if pluginInstance.cfg.TimeoutMs != 3000 {
		t.Errorf("timeout_ms not set: %d", pluginInstance.cfg.TimeoutMs)
	}
	if pluginInstance.cfg.BasicMode {
		t.Error("basic_mode should be false")
	}
	if pluginInstance.cfg.ScoreThreshold != 0.8 {
		t.Errorf("score_threshold = %v; want 0.8", pluginInstance.cfg.ScoreThreshold)
	}
	if err := Cleanup(); err != nil {
		t.Errorf("Cleanup() failed: %v", err)
	}
}

// ─── Standard Init(config any) error test ─────────────────

func TestInit_StandardSignature(t *testing.T) {
	cfg := map[string]interface{}{
		"service_url": "http://localhost:3001",
		"timeout_ms":  float64(2500),
		"basic_mode":  true,
	}
	if err := Init(cfg); err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	if GetName() != "freshnessguard" {
		t.Errorf("GetName() = %q; want 'freshnessguard'", GetName())
	}
	if err := Cleanup(); err != nil {
		t.Errorf("Cleanup() = %v; want nil", err)
	}
}

// ─── Recursion bypass tests ───────────────────────────────

func TestBypass_ContextHandling(t *testing.T) {
	p := testPlugin(true, "", 2000)

	// Nil context -> no bypass
	if p.isBypass(nil) {
		t.Error("isBypass(nil) should be false")
	}

	// Empty extra -> no bypass
	ctxEmpty := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	if p.isBypass(ctxEmpty) {
		t.Error("isBypass(empty) should be false")
	}

	// Direct bypass key
	ctxBypass := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctxBypass.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{
		"freshnessguard-bypass": "true",
	})
	if !p.isBypass(ctxBypass) {
		t.Error("isBypass with 'freshnessguard-bypass' should be true")
	}

	// Bifrost x-bf-eh header key
	ctxBfEh := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctxBfEh.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{
		"x-bf-eh-freshnessguard-bypass": "true",
	})
	if !p.isBypass(ctxBfEh) {
		t.Error("isBypass with 'x-bf-eh-freshnessguard-bypass' should be true")
	}
}

func TestPostLLMHook_BypassSkipsService(t *testing.T) {
	serverCalled := false
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	p := testPlugin(false, ts.URL, 2000)
	resp := makeResponse("GPT-4 costs $0.03 per 1K tokens")
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	ctx.SetValue(schemas.BifrostContextKeyRequestHeaders, map[string]string{
		"x-bf-eh-freshnessguard-bypass": "true",
	})

	_, _, err := postLLMForTest(p, ctx, resp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if serverCalled {
		t.Error("expected server NOT to be called when bypass header is set")
	}
	if testResponseHeaders["X-FreshnessGuard-Mode"] != "bypass" {
		t.Errorf("expected mode 'bypass', got %q", testResponseHeaders["X-FreshnessGuard-Mode"])
	}
}

// ─── Streaming choices pass-through ───────────────────────

func TestPostLLMHook_StreamingGraceful(t *testing.T) {
	p := testPlugin(true, "", 2000)
	streamingResp := &BifrostResponse{
		ChatResponse: &BifrostChatResponse{
			Model: "gpt-4o",
			Choices: []BifrostResponseChoice{
				{
					Index:                       0,
					ChatNonStreamResponseChoice: nil, // streaming chunk has no message
				},
			},
		},
	}

	got, _, err := postLLMForTest(p, nil, streamingResp)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("response should not be nil")
	}
}
