import { Button, Form, Input, Modal, message } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import type { PeekReportContextResult, SubmitReportInput } from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";

interface ReportIssueDialogProps {
  open: boolean;
  taskId?: string;
  onClose: () => void;
}

interface FormValues {
  description: string;
  contactEmail?: string;
}

export function ReportIssueDialog({ open, taskId, onClose }: ReportIssueDialogProps) {
  const [form] = Form.useForm<FormValues>();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);
  const [context, setContext] = useState<PeekReportContextResult | null>(null);

  useEffect(() => {
    if (!open || !taskId) {
      setContext(null);
      return;
    }
    let cancelled = false;
    officecli.peekReportContext(taskId).then((result) => {
      if (!cancelled) setContext(result);
    }).catch(() => {
      if (!cancelled) setContext(null);
    });
    return () => { cancelled = true; };
  }, [open, taskId]);

  async function handleCopyRequestId() {
    const requestId = context?.requestId;
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
      void message.success(t("report.toast.copiedRequestId"));
    } catch {
      void message.error(t("report.toast.copyFailed"));
    }
  }

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const input: SubmitReportInput = {
        taskId,
        description: values.description,
        contactEmail: values.contactEmail || undefined,
      };
      const result = await officecli.submitReport(input);
      const requestId = result.requestId || context?.requestId || "";
      void message.success({
        content: (
          <span>
            {t("report.toast.submitted", { ticketId: result.ticketId ?? "" })}
            {requestId ? (
              <>
                {" "}
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    void navigator.clipboard.writeText(requestId);
                    void message.success(t("report.toast.copiedRequestId"));
                  }}
                >
                  {t("report.toast.copyRequestId")}
                </Button>
              </>
            ) : null}
          </span>
        ),
        duration: 6,
      });
      onClose();
      form.resetFields();
    } catch (error) {
      void message.error(
        error instanceof Error ? error.message : t("report.toast.error"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title={t("report.dialog.title")}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      {context && (context.requestId || context.errorCode) ? (
        <div className="report-context-bar">
          {taskId ? <span className="report-context-item">{t("report.dialog.contextBar.task", { taskId })}</span> : null}
          {context.requestId ? <span className="report-context-item">{t("report.dialog.contextBar.request", { requestId: context.requestId })}</span> : null}
          {context.errorCode ? <span className="report-context-item">{t("report.dialog.contextBar.error", { errorCode: context.errorCode })}</span> : null}
        </div>
      ) : null}

      {context?.requestId ? (
        <Button
          icon={<CopyOutlined />}
          onClick={handleCopyRequestId}
          style={{ marginBottom: 16, borderRadius: 8 }}
        >
          {t("report.dialog.copyRequestId")}
        </Button>
      ) : null}

      <Form
        form={form}
        layout="vertical"
        initialValues={{ description: "", contactEmail: "" }}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="description"
          label={t("report.dialog.description.label")}
          rules={[
            { required: true, message: t("report.dialog.description.required") },
            { min: 10, message: t("report.dialog.description.minLength") },
            { max: 500 },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder={t("report.dialog.description.placeholder")}
            showCount
            maxLength={500}
          />
        </Form.Item>

        <Form.Item
          name="contactEmail"
          label={t("report.dialog.email.label")}
          rules={[
            { type: "email", message: t("report.dialog.email.invalid") },
          ]}
        >
          <Input placeholder={t("report.dialog.email.placeholder")} />
        </Form.Item>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button onClick={onClose}>{t("report.dialog.cancel")}</Button>
          <Button
            type="primary"
            htmlType="submit"
            loading={submitting}
            style={{ borderRadius: 8 }}
          >
            {t("report.dialog.submit")}
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
