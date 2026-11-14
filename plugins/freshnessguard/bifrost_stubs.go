package main

import "github.com/maximhq/bifrost/core/schemas"

// These aliases ensure every plugin hook uses the exact Bifrost core types.
// Go plugin symbol compatibility requires identical package type identity.
type BifrostContext = schemas.BifrostContext
type ChatMessageContent = schemas.ChatMessageContent
type ChatMessage = schemas.ChatMessage
type ChatNonStreamResponseChoice = schemas.ChatNonStreamResponseChoice
type BifrostResponseChoice = schemas.BifrostResponseChoice
type BifrostChatResponse = schemas.BifrostChatResponse
type BifrostUsage = schemas.BifrostLLMUsage
type BifrostResponse = schemas.BifrostResponse
type BifrostRequest = schemas.BifrostRequest
type BifrostError = schemas.BifrostError
type LLMPluginShortCircuit = schemas.LLMPluginShortCircuit
