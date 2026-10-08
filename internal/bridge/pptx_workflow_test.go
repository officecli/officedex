package bridge

import (
	"context"
	"encoding/json"
	"officedex/internal/types"
	"strings"
	"testing"
)

func TestAnimationWorkflowInferenceAndExplicitChoice(t *testing.T) {
	for _, c := range []struct{ prompt, value, want string }{{"生成动画 PPT", "", "animation"}, {"做一个动画公司介绍", "", "design"}, {"不要动画，逐项出现也不要", "", "design"}, {"动画 PPT", "design", "design"}, {"介绍产品", "animation", "animation"}} {
		got, err := resolvePPTXWorkflow(types.GenerateInput{DocumentType: types.DocPPTX, Prompt: c.prompt, PPTXWorkflow: c.value})
		if err != nil || got != c.want {
			t.Fatalf("%+v got %s %v", c, got, err)
		}
	}
	if _, err := resolvePPTXWorkflow(types.GenerateInput{DocumentType: types.DocDOCX, PPTXWorkflow: "animation"}); err == nil {
		t.Fatal("non PPTX workflow accepted")
	}
}
func TestAnimationRequiresBridgeCapability(t *testing.T) {
	c := New(Options{})
	c.capabilities.loaded = true
	c.capabilities.progressiveJSSDKSupported = true
	// Asked for by name, not inferred from the prompt. An inferred animation
	// now degrades to design on the default backend rather than failing the
	// request, so only an explicit choice still reaches this check.
	_, err := c.InvokeGenerate(context.Background(), types.GenerateInput{DocumentType: types.DocPPTX, PPTXWorkflow: "animation", Prompt: "动画 PPT"})
	if err == nil || !strings.Contains(err.Error(), "动画 PPT Skill") {
		t.Fatalf("%v", err)
	}
	if bridgeCapabilitiesFromPayload([]byte(`{"pptx_jssdk_animation":{"v1":"true"}}`)).animationJSSDKSupported {
		t.Fatal("string is not capability evidence")
	}
	if !bridgeCapabilitiesFromPayload([]byte(`{"pptx_jssdk_animation":{"v1":true}}`)).animationJSSDKSupported {
		t.Fatal("v1 missing")
	}
}
func TestAnimationWorkflowReachesTaskInvoke(t *testing.T) {
	c, f := newClientWithFake(t)
	defer c.Stop()
	c.capabilities.animationJSSDKSupported = true
	done := make(chan error, 1)
	go func() {
		_, err := c.InvokeGenerate(context.Background(), types.GenerateInput{DocumentType: types.DocPPTX, PPTXWorkflow: "animation", Topic: "例子", Prompt: "介绍三项内容"})
		done <- err
	}()
	request := f.readRequest(t)
	f.writeResponse(t, request.idString(), map[string]any{"id": "animation-session"}, nil)
	request = f.readRequest(t)
	var params struct {
		Args map[string]any `json:"args"`
	}
	if err := json.Unmarshal(request.Params, &params); err != nil {
		t.Fatal(err)
	}
	if params.Args["pptx_workflow"] != "animation" || params.Args["pptx_backend"] != "aippt-jssdk-design" {
		t.Fatal(params.Args)
	}
	f.writeResponse(t, request.idString(), map[string]any{"task_id": "animation-task", "status": "starting"}, nil)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
