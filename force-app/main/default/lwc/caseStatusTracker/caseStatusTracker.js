import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue, updateRecord } from "lightning/uiRecordApi";
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import CASE_OBJECT from "@salesforce/schema/Case";
import ID_FIELD from "@salesforce/schema/Case.Id";
import STATUS_FIELD from "@salesforce/schema/Case.Status";

// Fixed step order (KAN-6). Values must match the org's CaseStatus API values.
const STEPS = [
  { value: "New", label: "New", color: "red" },
  { value: "Working", label: "Working", color: "orange" },
  {
    value: "Waiting on Customer",
    label: "Waiting on Customer",
    color: "yellow"
  },
  { value: "Reply Received", label: "Reply Received", color: "green" },
  { value: "Closed", label: "Closed", color: "blue" }
];

const ESCALATED_STATUS = "Escalated";
// Escalated is a side state, not a step; it is drawn as if the case is at this step.
const ESCALATED_DISPLAY_STATUS = "Working";
const CLOSED_STATUS = "Closed";

const STATE_TEXT = {
  completed: "completed",
  current: "current step",
  future: "not started"
};

function reduceErrors(error) {
  const output = error?.body?.output;
  const messages = [
    ...(output?.errors ?? []).map((e) => e.message),
    ...Object.values(output?.fieldErrors ?? {})
      .flat()
      .map((e) => e.message)
  ].filter(Boolean);
  if (messages.length) {
    return messages.join(", ");
  }
  return error?.body?.message ?? error?.message ?? "Unknown error";
}

export default class CaseStatusTracker extends LightningElement {
  @api recordId;

  isSaving = false;

  @wire(getRecord, { recordId: "$recordId", fields: [STATUS_FIELD] })
  caseRecord;

  @wire(getObjectInfo, { objectApiName: CASE_OBJECT })
  objectInfo;

  get status() {
    return this.caseRecord?.data
      ? getFieldValue(this.caseRecord.data, STATUS_FIELD)
      : undefined;
  }

  get hasRecord() {
    return Boolean(this.caseRecord?.data);
  }

  get loadError() {
    return this.caseRecord?.error
      ? reduceErrors(this.caseRecord.error)
      : undefined;
  }

  get isEscalated() {
    return this.status === ESCALATED_STATUS;
  }

  get canEdit() {
    const info = this.objectInfo?.data;
    return Boolean(
      info?.updateable && info?.fields?.[STATUS_FIELD.fieldApiName]?.updateable
    );
  }

  get isDisabled() {
    return !this.canEdit || this.isSaving;
  }

  get steps() {
    const displayStatus = this.isEscalated
      ? ESCALATED_DISPLAY_STATUS
      : this.status;
    const currentIndex = STEPS.findIndex(
      (step) => step.value === displayStatus
    );
    return STEPS.map((step, index) => {
      let state = "future";
      if (currentIndex >= 0 && index < currentIndex) {
        state = "completed";
      } else if (index === currentIndex) {
        state = "current";
      }
      return {
        ...step,
        isCompleted: state === "completed",
        buttonClass: `step-button step-${state} color-${step.color}`,
        ariaLabel: `${step.label}, ${STATE_TEXT[state]}`,
        ariaCurrent: state === "current" ? "step" : null
      };
    });
  }

  async handleStepClick(event) {
    const newStatus = event.currentTarget.dataset.value;
    if (this.isDisabled || newStatus === this.status) {
      return;
    }

    if (newStatus === CLOSED_STATUS) {
      const confirmed = await LightningConfirm.open({
        message: "Are you sure you want to close this case?",
        label: "Close Case",
        theme: "warning"
      });
      if (!confirmed) {
        return;
      }
    }

    this.isSaving = true;
    try {
      await updateRecord({
        fields: {
          [ID_FIELD.fieldApiName]: this.recordId,
          [STATUS_FIELD.fieldApiName]: newStatus
        }
      });
      this.showToast(
        "Success",
        `Case status changed to ${newStatus}.`,
        "success"
      );
    } catch (error) {
      this.showToast(
        "Unable to update case status",
        reduceErrors(error),
        "error"
      );
    } finally {
      this.isSaving = false;
    }
  }

  showToast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
