import { Button, Checkbox, Form, Input, Modal, message } from "antd";
import { CopyOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useState } from "react";
import type { SubmitReportInput } from "../../shared/types";
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
  includeSettings: boolean;
  includeEvents: boolean;
  includeLogs: boolean;
  includeRecent: boolean;
  removePrompt: boolean;
}

export function ReportIssueDialog({ open, taskId, onClose }: ReportIssueDialogProps) {
  const [form] = Form.useForm<FormValues>();
  const t = useT();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const includeEvents = values.removePrompt ? false : values.includeEvents;
      const input: SubmitReportInput = {
        taskId,
        description: values.description,
        contactEmail: values.contactEmail || undefined,
        exportOpts: {
          includeSettings: values.includeSettings,
          includeEvents,
          includeLogs: values.includeLogs,
          includeRecent: values.includeRecent,
        },
      };
      const result = await officecli.submitReport(input);
      if (result.uploaded) {
        void message.success({
          content: (
            <span>
              {t("report.toast.success.ticket", { ticketId: result.ticketId ?? "" })}
              {" "}
              <Button
                type="link"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  void navigator.clipboard.writeText(result.ticketId ?? "");
                  void message.success(t("report.toast.copyTicket"));
                }}
              >
                {t("report.toast.copyTicket")}
              </Button>
            </span>
          ),
          duration: 6,
        });
      } else {
        void message.success({
          content: (
            <span>
              {t("report.toast.success.bundleOnly", { bundlePath: result.bundlePath ?? "" })}
              {" "}
              <Button
                type="link"
                size="small"
                icon={<FolderOpenOutlined />}
                onClick={() => {
                  if (result.bundlePath) void officecli.showItemInFolder(result.bundlePath);
                }}
              >
                {t("report.toast.openFolder")}
              </Button>
            </span>
          ),
          duration: 8,
        });
      }
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
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          description: "",
          contactEmail: "",
          includeSettings: true,
          includeEvents: true,
          includeLogs: true,
          includeRecent: true,
          removePrompt: false,
        }}
        onFinish={handleSubmit}
      >
        <Form.Item
          name="description"
          label={t("report.dialog.description.label")}
          rules={[
            { required: true, message: t("report.dialog.description.required") },
            { min: 10, message: t("report.dialog.description.minLength") },
            { max: 2000 },
          ]}
        >
          <Input.TextArea
            rows={4}
            placeholder={t("report.dialog.description.placeholder")}
            showCount
            maxLength={2000}
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

        <Form.Item label={t("report.dialog.sections.label")}>
          <Form.Item name="includeSettings" valuePropName="checked" noStyle>
            <Checkbox>{t("report.dialog.sections.settings")}</Checkbox>
          </Form.Item>
          <br />
          <Form.Item name="includeEvents" valuePropName="checked" noStyle>
            <Checkbox>{t("report.dialog.sections.events")}</Checkbox>
          </Form.Item>
          <br />
          <Form.Item name="includeLogs" valuePropName="checked" noStyle>
            <Checkbox>{t("report.dialog.sections.logs")}</Checkbox>
          </Form.Item>
          <br />
          <Form.Item name="includeRecent" valuePropName="checked" noStyle>
            <Checkbox>{t("report.dialog.sections.recent")}</Checkbox>
          </Form.Item>
        </Form.Item>

        <Form.Item name="removePrompt" valuePropName="checked">
          <Checkbox>{t("report.dialog.removePrompt")}</Checkbox>
        </Form.Item>

        <Form.Item dependencies={["removePrompt"]} noStyle>
          {() =>
            form.getFieldValue("removePrompt") ? (
              <p style={{ fontSize: 12, color: "#787671", marginTop: -12, marginBottom: 16 }}>
                {t("report.dialog.removePrompt.notice")}
              </p>
            ) : null
          }
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
