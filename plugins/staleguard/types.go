package main

type BifrostContext struct {
	RequestID string
	Extra     map[string]interface{}
}

type ChatMessageContent struct {
	ContentStr *string
	ContentArr []interface{}
}

type ChatMessage struct {
	Role    string
	Content *ChatMessageContent
}

type ChatNonStreamResponseChoice struct {
	Message *ChatMessage
}

type BifrostResponseChoice struct {
	Index        int
	FinishReason *string
	*ChatNonStreamResponseChoice
}

type BifrostChatResponse struct {
	ID      string
	Model   string
	Choices []BifrostResponseChoice
}

type BifrostResponse struct {
	Provider     string
	ChatResponse *BifrostChatResponse
	ExtraHeaders map[string]string
}

type BifrostRequest struct {
	Model string
}

type BifrostError struct {
	Message string
	Code    int
}

type LLMPluginShortCircuit struct {
	Response *BifrostResponse
}

type LLMPlugin interface {
	GetName() string
	Cleanup() error
	PreRequestHook(ctx *BifrostContext, req *BifrostRequest) error
	PreLLMHook(ctx *BifrostContext, req *BifrostRequest) (*BifrostRequest, *LLMPluginShortCircuit, error)
	PostLLMHook(ctx *BifrostContext, resp *BifrostResponse, e *BifrostError) (*BifrostResponse, *BifrostError, error)
}
