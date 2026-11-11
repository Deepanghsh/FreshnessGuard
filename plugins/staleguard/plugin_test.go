package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// helpers

func strPtr(s string) *string { return &s }

func makeResp(text string) *BifrostResponse {
	return &BifrostResponse{
		Provider: "openai",
		ChatResponse: &BifrostChatResponse{
			ID:    "test-id",
			Model: "gpt-4",
			Choices: []BifrostResponseChoice{
				{
					Index: 0,
					ChatNonStreamResponseChoice: &ChatNonStreamResponseChoice{
						Message: &ChatMessage{
							Role: "assistant",
							Content: &ChatMessageContent{
								ContentStr: strPtr(text),
							},
						},
					},
				},
			},
		},
		ExtraHeaders: make(map[string]string),
	}
}

func newPlugin(cfg Config) *StaleGuardPlugin {
	return &StaleGuardPlugin{
		config: cfg,
		logger: log.New(io.Discard, "", 0),
	}
}

// TestGetName verifies the plugin name
func TestGetName(t *testing.T) {
	p := newPlugin(Config{BasicMode: true})
	if got := p.GetName(); got != "staleguard" {
		t.Errorf("GetName() = %q; want %q", got, "staleguard")
	}
}

// TestBasicModeNoClaims — clean text, no staleness markers
func TestBasicModeNoClaims(t *testing.T) {
	p := newPlugin(Config{BasicMode: true})
	resp := makeResp("The sky is blue and water is wet.")

	got, bifErr, err := p.PostLLMHook(nil, resp, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if bifErr != nil {
		t.Fatalf("unexpected bif error: %v", bifErr)
	}
	if got.ExtraHeaders["X-StaleGuard-Mode"] != "basic" {
		t.Errorf("mode header = %q; want %q", got.ExtraHeaders["X-StaleGuard-Mode"], "basic")
	}
	// No stale claims → content should be unchanged
	if strings.Contains(*got.ChatResponse.Choices[0].Message.Content.ContentStr, "[StaleGuard]") {
		t.Error("content should not contain StaleGuard annotation when no stale claims")
	}
}

// TestBasicModeWithClaims — version + price triggers annotation
func TestBasicModeWithClaims(t *testing.T) {
	p := newPlugin(Config{BasicMode: true})
	resp := makeResp("The latest version is v3.2.1 and costs $29.99 as of 2023.")

	got, _, err := p.PostLLMHook(nil, resp, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	content := *got.ChatResponse.Choices[0].Message.Content.ContentStr
	if !strings.Contains(content, "[StaleGuard]") {
		t.Error("expected StaleGuard annotation in content")
	}
	if got.ExtraHeaders["X-StaleGuard-Stale"] == "0" {
		t.Error("expected non-zero stale count")
	}
}

// TestNilResponse — plugin must not panic on nil resp
func TestNilResponse(t *testing.T) {
	p := newPlugin(Config{BasicMode: true})
	got, bifErr, err := p.PostLLMHook(nil, nil, nil)
	if err != nil || bifErr != nil || got != nil {
		t.Errorf("expected (nil, nil, nil), got (%v, %v, %v)", got, bifErr, err)
	}
}

// TestServiceModeFailOpen — service down → bypass mode, no error
func TestServiceModeFailOpen(t *testing.T) {
	p := newPlugin(Config{
		ServiceURL: "http://127.0.0.1:19999", // nothing listening
		TimeoutMs:  200,
		BasicMode:  false,
	})
	resp := makeResp("The current price is $50.00.")

	got, _, err := p.PostLLMHook(&BifrostContext{RequestID: "test-req"}, resp, nil)
	if err != nil {
		t.Fatalf("unexpected error (should fail open): %v", err)
	}
	if got.ExtraHeaders["X-StaleGuard-Mode"] != "bypass" {
		t.Errorf("mode = %q; want bypass", got.ExtraHeaders["X-StaleGuard-Mode"])
	}
}

// TestServiceModeSuccess — mock service returns stale claims
func TestServiceModeSuccess(t *testing.T) {
	svcResp := ServiceResponse{
		OverallScore: 0.4,
		StaleCount:   2,
		TotalClaims:  3,
		Claims: []Claim{
			{Text: "v3.2.1", Category: "version", Value: "v3.2.1", Score: 0.85},
			{Text: "$29.99", Category: "pricing", Value: "$29.99", Score: 0.9},
		},
	}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/check" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(svcResp)
	}))
	defer ts.Close()

	p := newPlugin(Config{
		ServiceURL: ts.URL,
		TimeoutMs:  2000,
		BasicMode:  false,
	})
	resp := makeResp("The latest version is v3.2.1 and costs $29.99.")

	got, _, err := p.PostLLMHook(&BifrostContext{RequestID: "req-svc"}, resp, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ExtraHeaders["X-StaleGuard-Mode"] != "service" {
		t.Errorf("mode = %q; want service", got.ExtraHeaders["X-StaleGuard-Mode"])
	}
	if got.ExtraHeaders["X-StaleGuard-Score"] != fmt.Sprintf("%.2f", svcResp.OverallScore) {
		t.Errorf("score header mismatch: %q", got.ExtraHeaders["X-StaleGuard-Score"])
	}
	content := *got.ChatResponse.Choices[0].Message.Content.ContentStr
	if !strings.Contains(content, "[StaleGuard]") {
		t.Error("expected StaleGuard annotation for stale service response")
	}
}

// TestExtractBasicClaims unit-tests the regex extractor
func TestExtractBasicClaims(t *testing.T) {
	cases := []struct {
		text     string
		wantCats []string
	}{
		{"Use v2.0.1 today", []string{"version"}},
		{"Costs $9.99 monthly", []string{"pricing"}},
		{"Released in 2024", []string{"date"}},
		{"The current best option", []string{"fact"}},
		{"Nothing interesting here", nil},
	}
	for _, tc := range cases {
		t.Run(tc.text, func(t *testing.T) {
			claims := extractBasicClaims(tc.text)
			cats := make(map[string]bool)
			for _, c := range claims {
				cats[c.Category] = true
			}
			for _, want := range tc.wantCats {
				if !cats[want] {
					t.Errorf("expected category %q in claims for %q; got %v", want, tc.text, claims)
				}
			}
			if len(tc.wantCats) == 0 && len(claims) != 0 {
				t.Errorf("expected no claims for %q; got %v", tc.text, claims)
			}
		})
	}
}

// TestInitPlugin verifies the factory function
func TestInitPlugin(t *testing.T) {
	cfg := map[string]interface{}{
		"service_url": "http://localhost:3001",
		"timeout_ms":  float64(500),
		"basic_mode":  true,
		"api_key":     "secret",
	}
	iface, err := InitPlugin(cfg)
	if err != nil {
		t.Fatalf("InitPlugin error: %v", err)
	}
	plug, ok := iface.(*StaleGuardPlugin)
	if !ok {
		t.Fatal("InitPlugin did not return *StaleGuardPlugin")
	}
	if plug.config.ServiceURL != "http://localhost:3001" {
		t.Errorf("ServiceURL = %q", plug.config.ServiceURL)
	}
	if plug.config.TimeoutMs != 500 {
		t.Errorf("TimeoutMs = %d", plug.config.TimeoutMs)
	}
	if !plug.config.BasicMode {
		t.Error("BasicMode should be true")
	}
	if plug.config.ApiKey != "secret" {
		t.Error("ApiKey not set")
	}
}
