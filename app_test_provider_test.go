package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"officedex/internal/netproxy"
	"officedex/internal/types"
)

func TestProviderProbeFor(t *testing.T) {
	cases := []struct {
		name   string
		input  types.LlmProvider
		wantU  string
		wantH  map[string]string
		wantM  string
	}{
		{
			name:  "openai",
			input: types.LlmProvider{Type: types.LlmOpenAI, BaseURL: "https://api.openai.com/v1", APIKey: "sk-abc"},
			wantU: "https://api.openai.com/v1/models",
			wantH: map[string]string{"Authorization": "Bearer sk-abc"},
			wantM: http.MethodGet,
		},
		{
			name:  "azure",
			input: types.LlmProvider{Type: types.LlmAzure, BaseURL: "https://x.openai.azure.com", APIKey: "az-key"},
			wantU: "https://x.openai.azure.com/openai/models?api-version=2024-02-15-preview",
			wantH: map[string]string{"api-key": "az-key"},
			wantM: http.MethodGet,
		},
		{
			name:  "anthropic",
			input: types.LlmProvider{Type: types.LlmAnthropic, BaseURL: "https://api.anthropic.com", APIKey: "ant-key"},
			wantU: "https://api.anthropic.com/v1/models",
			wantH: map[string]string{"x-api-key": "ant-key", "anthropic-version": "2023-06-01"},
			wantM: http.MethodGet,
		},
		{
			name:  "custom-chat-completions",
			input: types.LlmProvider{Type: types.LlmCustom, BaseURL: "https://4zapi.com/v1", APIKey: "sk-x", Model: "gpt-4"},
			wantU: "https://4zapi.com/v1/chat/completions",
			wantH: map[string]string{"Authorization": "Bearer sk-x", "Content-Type": "application/json"},
			wantM: http.MethodPost,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p, err := providerProbeFor(tc.input)
			if err != nil {
				t.Fatalf("providerProbeFor: %v", err)
			}
			if p.method != tc.wantM {
				t.Errorf("method = %q, want %q", p.method, tc.wantM)
			}
			if p.url != tc.wantU {
				t.Errorf("url = %q, want %q", p.url, tc.wantU)
			}
			for k, v := range tc.wantH {
				if p.headers[k] != v {
					t.Errorf("header %q = %q, want %q", k, p.headers[k], v)
				}
			}
		})
	}
}

func TestProviderProbeForCustomEmbedsModel(t *testing.T) {
	p, err := providerProbeFor(types.LlmProvider{
		Type: types.LlmCustom, BaseURL: "https://x.example.com", APIKey: "k", Model: "Deepseek-v4-flash4",
	})
	if err != nil {
		t.Fatalf("providerProbeFor: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(p.body, &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["model"] != "Deepseek-v4-flash4" {
		t.Errorf("body.model = %v, want Deepseek-v4-flash4", body["model"])
	}
	if body["max_tokens"].(float64) != 1 {
		t.Errorf("body.max_tokens = %v, want 1", body["max_tokens"])
	}
}

func TestProviderProbeForRejectsEmpty(t *testing.T) {
	_, err := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: ""})
	if err == nil {
		t.Fatal("expected error for empty BaseURL")
	}
}

func TestRunHTTPProbe(t *testing.T) {
	t.Run("openai-200", func(t *testing.T) {
		var seenAuth string
		var seenPath string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenAuth = r.Header.Get("Authorization")
			seenPath = r.URL.Path
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: srv.URL, APIKey: "sk-test"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if !res.OK || res.HTTPStatus != 200 {
			t.Errorf("res = %+v", res)
		}
		if seenAuth != "Bearer sk-test" {
			t.Errorf("Authorization header = %q", seenAuth)
		}
		if seenPath != "/models" {
			t.Errorf("path = %q", seenPath)
		}
	})

	t.Run("anthropic-401-key-rejected", func(t *testing.T) {
		var seenKey, seenVer string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenKey = r.Header.Get("x-api-key")
			seenVer = r.Header.Get("anthropic-version")
			w.WriteHeader(http.StatusUnauthorized)
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmAnthropic, BaseURL: srv.URL, APIKey: "bad"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 401")
		}
		if res.HTTPStatus != 401 {
			t.Errorf("HTTPStatus = %d", res.HTTPStatus)
		}
		if seenKey != "bad" || seenVer != "2023-06-01" {
			t.Errorf("headers = %q / %q", seenKey, seenVer)
		}
	})

	t.Run("custom-posts-chat-completions-body", func(t *testing.T) {
		var receivedBody map[string]any
		var seenMethod, seenPath, seenAuth, seenContentType string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			seenMethod = r.Method
			seenPath = r.URL.Path
			seenAuth = r.Header.Get("Authorization")
			seenContentType = r.Header.Get("Content-Type")
			data, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(data, &receivedBody)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"pong"}}]}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL, APIKey: "sk-x", Model: "gpt-4o-mini",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if !res.OK || res.HTTPStatus != 200 {
			t.Errorf("res = %+v", res)
		}
		if seenMethod != http.MethodPost {
			t.Errorf("method = %q, want POST", seenMethod)
		}
		if seenPath != "/chat/completions" {
			t.Errorf("path = %q", seenPath)
		}
		if seenAuth != "Bearer sk-x" {
			t.Errorf("Authorization = %q", seenAuth)
		}
		if seenContentType != "application/json" {
			t.Errorf("Content-Type = %q", seenContentType)
		}
		if receivedBody["model"] != "gpt-4o-mini" {
			t.Errorf("model in body = %v", receivedBody["model"])
		}
	})

	t.Run("custom-404-wrong-path", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL + "/v12", APIKey: "k", Model: "x",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 404, got %+v", res)
		}
		if res.HTTPStatus != 404 {
			t.Errorf("HTTPStatus = %d, want 404", res.HTTPStatus)
		}
	})

	t.Run("custom-400-model-not-found", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"message":"model_not_found"}}`))
		}))
		defer srv.Close()
		p, _ := providerProbeFor(types.LlmProvider{
			Type: types.LlmCustom, BaseURL: srv.URL, APIKey: "k", Model: "ghost-model",
		})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on 400")
		}
		if res.HTTPStatus != 400 {
			t.Errorf("HTTPStatus = %d, want 400", res.HTTPStatus)
		}
	})

	t.Run("network-error-connection-refused", func(t *testing.T) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("net.Listen: %v", err)
		}
		addr := ln.Addr().String()
		ln.Close()
		p, _ := providerProbeFor(types.LlmProvider{Type: types.LlmOpenAI, BaseURL: "http://" + addr, APIKey: "k"})
		res := runHTTPProbe(context.Background(), netproxy.NewPool(), p)
		if res.OK {
			t.Errorf("expected OK=false on closed port")
		}
		if res.HTTPStatus != 0 {
			t.Errorf("HTTPStatus = %d, want 0", res.HTTPStatus)
		}
		if res.Error == "" {
			t.Errorf("expected Error to be populated")
		}
	})
}

func TestTestProviderRejectsHostedMode(t *testing.T) {
	a := &App{
		proxyPool: netproxy.NewPool(),
		cachedSettings: types.UserSettings{
			Defaults: types.GenerateDefaults{RuntimeMode: types.RuntimeHosted},
		},
	}
	_, err := a.TestProvider()
	if err == nil {
		t.Fatal("expected error for hosted mode")
	}
}
