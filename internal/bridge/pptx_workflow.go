package bridge

import (
	"fmt"
	"officedex/internal/types"
	"regexp"
	"strings"
)

var animationPPTIntent = regexp.MustCompile(`(?i)(动画\s*(pptx?|演示|幻灯片)|pptx?\s*动画|animated\s+(pptx?|presentation|slides)|依次出现|交错入场|逐项出现|自动放映)`)
var staticPPTIntent = regexp.MustCompile(`(?i)(不要动画|不加动画|无需动画|无动画|静态\s*ppt|without\s+animation|no\s+animation)`)

func resolvePPTXWorkflow(input types.GenerateInput) (string, error) {
	value := strings.TrimSpace(input.PPTXWorkflow)
	if input.DocumentType != types.DocPPTX {
		if value != "" {
			return "", fmt.Errorf("动画 PPT 选项只适用于 PPTX")
		}
		return "", nil
	}
	switch value {
	case "design", "animation":
		return value, nil
	case "":
		if !staticPPTIntent.MatchString(input.Prompt) && animationPPTIntent.MatchString(input.Prompt) {
			return "animation", nil
		}
		return "design", nil
	default:
		return "", fmt.Errorf("未知 PPT 工作流 %q", value)
	}
}
