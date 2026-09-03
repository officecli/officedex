// Package providerprobe turns an LLM provider's settings into a single
// request that proves the credentials work, and interprets what comes back.
//
// This is the whole of "test connection" for a custom provider: which URL,
// which auth header, which minimal body each vendor accepts, and how to read
// an error out of a response whose shape differs per vendor. It lived among
// four hundred other lines in app.go while depending on nothing the app
// holds -- settings and a proxy pool are both passed in -- and its tests
// already targeted these two functions rather than the App around them.
package providerprobe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"officedex/internal/mask"
	"officedex/internal/netproxy"
	"officedex/internal/types"
)

// Probe describes the network request a connection test should issue to
// validate the user's configured provider. Every provider type ends up issuing
// a real HTTP request — we deliberately avoid host-only TCP probes here
// because "host alive" is a false trust signal: it greenlights wrong paths,
// rejected keys, and nonexistent model names.
type Probe struct {
	method     string
	url        string
	headers    map[string]string
	body       []byte
	displayURL string
}

func For(p types.LlmProvider) (Probe, error) {
	base := strings.TrimRight(strings.TrimSpace(p.BaseURL), "/")
	if base == "" {
		return Probe{}, errors.New("test_provider.base_url_required")
	}

	// Build a "hi" chat completion request body. All providers now send a
	// real conversation message instead of probing /models — this exercises
	// the same code path officecli uses for generation, catching issues like
	// wrong model names, rate limits, and auth errors that a GET /models
	// probe would miss.
	model := strings.TrimSpace(p.Model)
	chatMessages := []map[string]string{{"role": "user", "content": "hi"}}

	switch p.Type {
	case types.LlmOpenAI:
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return Probe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return Probe{
			method:     http.MethodPost,
			url:        base + "/chat/completions",
			headers:    map[string]string{"Authorization": "Bearer " + p.APIKey, "Content-Type": "application/json"},
			body:       body,
			displayURL: mask.Host(base) + "/chat/completions",
		}, nil

	case types.LlmAzure:
		probeURL := base + "/openai/deployments/" + model + "/chat/completions?api-version=2024-02-15-preview"
		body, err := json.Marshal(map[string]any{
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return Probe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return Probe{
			method:     http.MethodPost,
			url:        probeURL,
			headers:    map[string]string{"api-key": p.APIKey, "Content-Type": "application/json"},
			body:       body,
			displayURL: mask.Host(base) + "/openai/deployments/" + model + "/chat/completions",
		}, nil

	case types.LlmAnthropic:
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   []map[string]string{{"role": "user", "content": "hi"}},
			"max_tokens": 50,
		})
		if err != nil {
			return Probe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return Probe{
			method: http.MethodPost,
			url:    base + "/v1/messages",
			headers: map[string]string{
				"x-api-key":         p.APIKey,
				"anthropic-version": "2023-06-01",
				"Content-Type":      "application/json",
			},
			body:       body,
			displayURL: mask.Host(base) + "/v1/messages",
		}, nil

	case types.LlmCustom:
		// Custom endpoints are almost always OpenAI-compatible (4zapi,
		// OpenRouter, Deepseek, local llama.cpp, etc.). Send a real chat
		// completion to exercise the full generation path.
		body, err := json.Marshal(map[string]any{
			"model":      model,
			"messages":   chatMessages,
			"max_tokens": 50,
			"stream":     false,
		})
		if err != nil {
			return Probe{}, fmt.Errorf("test_provider.marshal: %w", err)
		}
		return Probe{
			method: http.MethodPost,
			url:    base + "/chat/completions",
			headers: map[string]string{
				"Authorization": "Bearer " + p.APIKey,
				"Content-Type":  "application/json",
			},
			body:       body,
			displayURL: mask.Host(base) + "/chat/completions",
		}, nil

	default:
		return Probe{}, fmt.Errorf("test_provider.unsupported_type: %s", p.Type)
	}
}

func Run(ctx context.Context, pool *netproxy.Pool, p Probe) types.ProviderTestResult {
	client := pool.NewClient(15 * time.Second)
	var bodyReader io.Reader
	if len(p.body) > 0 {
		bodyReader = bytes.NewReader(p.body)
	}
	req, err := http.NewRequestWithContext(ctx, p.method, p.url, bodyReader)
	if err != nil {
		return types.ProviderTestResult{URL: p.displayURL, Error: err.Error()}
	}
	for k, v := range p.headers {
		req.Header.Set(k, v)
	}
	start := time.Now()
	resp, err := client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return types.ProviderTestResult{URL: p.displayURL, LatencyMs: latency, Error: err.Error()}
	}
	defer resp.Body.Close()

	respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if readErr != nil {
		return types.ProviderTestResult{
			URL:       p.displayURL,
			LatencyMs: latency,
			Error:     fmt.Sprintf("read response: %v", readErr),
		}
	}

	result := types.ProviderTestResult{
		OK:         resp.StatusCode >= 200 && resp.StatusCode < 300,
		HTTPStatus: resp.StatusCode,
		LatencyMs:  latency,
		URL:        p.displayURL,
	}

	if result.OK {
		if msg := extractResponseMessage(respBody); msg != "" {
			result.ResponseMessage = msg
		}
	} else {
		// Include body snippet in error for debugging (e.g. model_not_found).
		if msg := extractErrorFromBody(respBody); msg != "" {
			result.Error = msg
		}
	}

	return result
}

// extractResponseMessage parses a chat completion response body and returns
// the first line of the assistant's reply, or empty on failure.
func extractResponseMessage(body []byte) string {
	// Try OpenAI-compatible format: {"choices":[{"message":{"content":"..."}}]}
	var openaiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(body, &openaiResp) == nil {
		for _, c := range openaiResp.Choices {
			if c.Message.Content != "" {
				return firstLine(c.Message.Content, 200)
			}
		}
	}

	// Try Anthropic format: {"content":[{"type":"text","text":"..."}]}
	var anthropicResp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if json.Unmarshal(body, &anthropicResp) == nil {
		for _, c := range anthropicResp.Content {
			if c.Type == "text" && c.Text != "" {
				return firstLine(c.Text, 200)
			}
		}
	}

	return ""
}

// extractErrorFromBody tries to pull a human-readable error message from the
// response body. Handles OpenAI-style {"error":{"message":"..."}} and
// Anthropic-style {"error":{"message":"..."}}.
func extractErrorFromBody(body []byte) string {
	var errResp struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &errResp) == nil && errResp.Error.Message != "" {
		msg := errResp.Error.Message
		if errResp.Error.Type != "" {
			msg = errResp.Error.Type + ": " + msg
		}
		return firstLine(msg, 200)
	}
	return ""
}

func firstLine(s string, maxLen int) string {
	if idx := strings.IndexAny(s, "\r\n"); idx >= 0 {
		s = s[:idx]
	}
	if len(s) > maxLen {
		s = s[:maxLen] + "…"
	}
	return s
}
