package main

// bifrost_stubs.go — local type stubs mirroring github.com/maximhq/bifrost/core/schemas
// These are used for local compilation and testing only.
// In the Docker production build, replace with real bifrost imports via replace directive.
// See: https://github.com/maximhq/bifrost

// BifrostContext carries per-request metadata through the plugin pipeline.
type BifrostContext struct {
	RequestID string
	Extra     map[string]interface{}
}

// ChatMessageContent holds the LLM-generated text in one of two forms.
type ChatMessageContent struct {
	ContentStr *string      // plain-text response
	ContentArr []interface{} // multimodal response array
}

// ChatMessage is a single message in the conversation.
type ChatMessage struct {
	Role    string
	Content *ChatMessageContent
}

// ChatNonStreamResponseChoice wraps the message for non-streaming responses.
type ChatNonStreamResponseChoice struct {
	Message *ChatMessage
}

// BifrostResponseChoice is one candidate completion.
type BifrostResponseChoice struct {
	Index        int
	FinishReason *string
	*ChatNonStreamResponseChoice
}

// BifrostChatResponse is the main chat completion response body.
type BifrostChatResponse struct {
	ID      string
	Model   string
	Choices []BifrostResponseChoice
	Usage   *BifrostUsage
}

// BifrostUsage holds token counts.
type BifrostUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

// BifrostResponse is the top-level response returned by the gateway.
type BifrostResponse struct {
	Provider     string
	ChatResponse *BifrostChatResponse
	ExtraHeaders map[string]string // injected by plugins
}

// BifrostRequest is the request sent to the LLM provider.
type BifrostRequest struct {
	Model    string
	Messages []interface{}
}

// BifrostError wraps LLM or gateway errors.
type BifrostError struct {
	Message    string
	StatusCode int
	IsBifrost  bool
}

// LLMPluginShortCircuit lets PreLLMHook skip the actual LLM call.
type LLMPluginShortCircuit struct {
	Response *BifrostResponse
}

// LLMPlugin is the interface every Bifrost LLM plugin must implement.
type LLMPlugin interface {
	GetName() string
	Cleanup() error
	PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error
	PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error)
	PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error)
}
