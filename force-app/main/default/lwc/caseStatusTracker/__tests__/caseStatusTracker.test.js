import { createElement } from "@lwc/engine-dom";
import CaseStatusTracker from "c/caseStatusTracker";
import { getRecord, updateRecord } from "lightning/uiRecordApi";
import { getObjectInfo } from "lightning/uiObjectInfoApi";
import LightningConfirm from "lightning/confirm";

const SHOW_TOAST_EVENT = "lightning__showtoast";
const RECORD_ID = "500000000000001AAA";
const STEP_VALUES = [
  "New",
  "Working",
  "Waiting on Customer",
  "Reply Received",
  "Closed"
];

const caseWithStatus = (status) => ({
  apiName: "Case",
  id: RECORD_ID,
  fields: { Status: { value: status, displayValue: status } }
});

const objectInfo = (statusUpdateable = true) => ({
  apiName: "Case",
  updateable: true,
  fields: { Status: { apiName: "Status", updateable: statusUpdateable } }
});

// eslint-disable-next-line @lwc/lwc/no-async-operation
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

function createComponent() {
  const element = createElement("c-case-status-tracker", {
    is: CaseStatusTracker
  });
  element.recordId = RECORD_ID;
  document.body.appendChild(element);
  return element;
}

async function renderWith(status, { statusUpdateable = true } = {}) {
  const element = createComponent();
  getRecord.emit(caseWithStatus(status));
  getObjectInfo.emit(objectInfo(statusUpdateable));
  await flushPromises();
  return element;
}

const buttons = (element) => [
  ...element.shadowRoot.querySelectorAll("button.step-button")
];
const buttonFor = (element, value) =>
  element.shadowRoot.querySelector(`button[data-value="${value}"]`);
const stateOf = (button) =>
  ["completed", "current", "future"].find((s) =>
    button.classList.contains(`step-${s}`)
  );
const badge = (element) =>
  element.shadowRoot.querySelector('[data-id="escalated-badge"]');

function captureToasts(element) {
  const handler = jest.fn();
  element.addEventListener(SHOW_TOAST_EVENT, handler);
  return handler;
}

describe("c-case-status-tracker", () => {
  beforeEach(() => {
    LightningConfirm.open = jest.fn().mockResolvedValue(true);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
    updateRecord.mockResolvedValue({});
  });

  describe("rendering (AC 2-5, 11)", () => {
    it("renders the five steps in fixed order with labels and rainbow colors", async () => {
      const element = await renderWith("New");

      const all = buttons(element);
      expect(all.map((b) => b.dataset.value)).toEqual(STEP_VALUES);
      const labels = [
        ...element.shadowRoot.querySelectorAll(".step-label")
      ].map((l) => l.textContent);
      expect(labels).toEqual(STEP_VALUES);
      const colors = all.map((b) =>
        [...b.classList].find((c) => c.startsWith("color-"))
      );
      expect(colors).toEqual([
        "color-red",
        "color-orange",
        "color-yellow",
        "color-green",
        "color-blue"
      ]);
    });

    it.each(STEP_VALUES.map((status, index) => [status, index]))(
      "marks completed, current, and future steps when Status is %s",
      async (status, currentIndex) => {
        const element = await renderWith(status);

        buttons(element).forEach((button, index) => {
          const expected =
            index < currentIndex
              ? "completed"
              : index === currentIndex
                ? "current"
                : "future";
          expect(stateOf(button)).toBe(expected);
          expect(button.querySelector("svg.smiley") !== null).toBe(
            expected === "completed"
          );
        });
      }
    );

    it("sets accessible names and aria-current", async () => {
      const element = await renderWith("Waiting on Customer");

      expect(buttonFor(element, "New").getAttribute("aria-label")).toBe(
        "New, completed"
      );
      expect(
        buttonFor(element, "Waiting on Customer").getAttribute("aria-label")
      ).toBe("Waiting on Customer, current step");
      expect(
        buttonFor(element, "Waiting on Customer").getAttribute("aria-current")
      ).toBe("step");
      expect(buttonFor(element, "Closed").getAttribute("aria-label")).toBe(
        "Closed, not started"
      );
      expect(buttonFor(element, "Closed").hasAttribute("aria-current")).toBe(
        false
      );
    });

    it("shows every step as future for a status outside the fixed list", async () => {
      const element = await renderWith("Some Other Status");

      expect(buttons(element).map(stateOf)).toEqual(Array(5).fill("future"));
    });

    it("shows the record load error when getRecord fails", async () => {
      const element = createComponent();
      getRecord.error({ message: "Insufficient access" });
      await flushPromises();

      expect(
        element.shadowRoot.querySelector('[data-id="load-error"]')
      ).not.toBeNull();
      expect(buttons(element)).toHaveLength(0);
    });
  });

  describe("escalated side state (AC 6)", () => {
    it("shows the badge and treats Working as current when Escalated", async () => {
      const element = await renderWith("Escalated");

      expect(badge(element)).not.toBeNull();
      expect(buttons(element).map(stateOf)).toEqual([
        "completed",
        "current",
        "future",
        "future",
        "future"
      ]);
      expect(buttonFor(element, "Escalated")).toBeNull();
    });

    it.each(STEP_VALUES)(
      "hides the badge when Status is %s",
      async (status) => {
        const element = await renderWith(status);

        expect(badge(element)).toBeNull();
      }
    );
  });

  describe("changing status (AC 7)", () => {
    it("updates Status and shows a success toast when a future step is clicked", async () => {
      const element = await renderWith("New");
      const toasts = captureToasts(element);

      buttonFor(element, "Reply Received").click();
      await flushPromises();

      expect(updateRecord).toHaveBeenCalledWith({
        fields: { Id: RECORD_ID, Status: "Reply Received" }
      });
      expect(toasts).toHaveBeenCalledTimes(1);
      expect(toasts.mock.calls[0][0].detail.variant).toBe("success");
    });

    it("allows moving backward without confirmation", async () => {
      const element = await renderWith("Closed");

      buttonFor(element, "Working").click();
      await flushPromises();

      expect(LightningConfirm.open).not.toHaveBeenCalled();
      expect(updateRecord).toHaveBeenCalledWith({
        fields: { Id: RECORD_ID, Status: "Working" }
      });
    });

    it("does nothing when the current step is clicked", async () => {
      const element = await renderWith("Working");

      buttonFor(element, "Working").click();
      await flushPromises();

      expect(updateRecord).not.toHaveBeenCalled();
    });

    it("sets Working when Working is clicked while Escalated", async () => {
      const element = await renderWith("Escalated");

      buttonFor(element, "Working").click();
      await flushPromises();

      expect(updateRecord).toHaveBeenCalledWith({
        fields: { Id: RECORD_ID, Status: "Working" }
      });
    });

    it("closes the case after the user confirms", async () => {
      const element = await renderWith("Reply Received");

      buttonFor(element, "Closed").click();
      await flushPromises();

      expect(LightningConfirm.open).toHaveBeenCalledTimes(1);
      expect(updateRecord).toHaveBeenCalledWith({
        fields: { Id: RECORD_ID, Status: "Closed" }
      });
    });

    it("does not close the case when the user cancels the confirmation", async () => {
      LightningConfirm.open = jest.fn().mockResolvedValue(false);
      const element = await renderWith("Reply Received");

      buttonFor(element, "Closed").click();
      await flushPromises();

      expect(updateRecord).not.toHaveBeenCalled();
    });
  });

  describe("save errors (AC 8)", () => {
    it("shows the Salesforce error and keeps the previous state when the update fails", async () => {
      updateRecord.mockRejectedValue({
        body: {
          output: {
            errors: [{ message: "Status cannot be changed" }],
            fieldErrors: {}
          }
        }
      });
      const element = await renderWith("New");
      const toasts = captureToasts(element);

      buttonFor(element, "Working").click();
      await flushPromises();

      expect(toasts).toHaveBeenCalledTimes(1);
      expect(toasts.mock.calls[0][0].detail.variant).toBe("error");
      expect(toasts.mock.calls[0][0].detail.message).toBe(
        "Status cannot be changed"
      );
      expect(stateOf(buttonFor(element, "New"))).toBe("current");
      expect(stateOf(buttonFor(element, "Working"))).toBe("future");
    });

    it("reports field errors when no page-level error is returned", async () => {
      updateRecord.mockRejectedValue({
        body: {
          output: {
            errors: [],
            fieldErrors: { Reason: [{ message: "Reason is required" }] }
          }
        }
      });
      const element = await renderWith("Reply Received");
      const toasts = captureToasts(element);

      buttonFor(element, "Closed").click();
      await flushPromises();

      expect(toasts.mock.calls[0][0].detail.message).toBe("Reason is required");
    });
  });

  describe("read-only users (AC 9)", () => {
    it("disables every step when Status is not updateable", async () => {
      const element = await renderWith("New", { statusUpdateable: false });

      buttons(element).forEach((button) => expect(button.disabled).toBe(true));
    });

    it("does not update when a disabled step is clicked", async () => {
      const element = await renderWith("New", { statusUpdateable: false });

      buttonFor(element, "Working").click();
      await flushPromises();

      expect(updateRecord).not.toHaveBeenCalled();
    });

    it("disables steps until object info has loaded", async () => {
      const element = createComponent();
      getRecord.emit(caseWithStatus("New"));
      await flushPromises();

      buttons(element).forEach((button) => expect(button.disabled).toBe(true));
    });
  });

  describe("reactivity (AC 10)", () => {
    it("re-renders when the record changes elsewhere on the page", async () => {
      const element = await renderWith("New");

      getRecord.emit(caseWithStatus("Waiting on Customer"));
      await flushPromises();

      expect(buttons(element).map(stateOf)).toEqual([
        "completed",
        "completed",
        "current",
        "future",
        "future"
      ]);
    });
  });
});
