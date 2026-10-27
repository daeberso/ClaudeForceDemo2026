import { createElement } from "@lwc/engine-dom";
import CaseHeatMap from "c/caseHeatMap";
import { loadScript } from "lightning/platformResourceLoader";
import { getObjectInfo, getPicklistValues } from "lightning/uiObjectInfoApi";
import getCaseLocations from "@salesforce/apex/CaseHeatMapController.getCaseLocations";
import { supportsWebGL } from "../webgl";

// WebGL is off by default, so the KAN-7 tests exercise the flat map at World.
jest.mock("../webgl", () => ({ supportsWebGL: jest.fn(() => false) }));

jest.mock(
  "@salesforce/apex/CaseHeatMapController.getCaseLocations",
  () => {
    const { createApexTestWireAdapter } = require("@salesforce/sfdx-lwc-jest");
    return { default: createApexTestWireAdapter(jest.fn()) };
  },
  { virtual: true }
);

const DATA = {
  points: [
    {
      lat: 37.77,
      lng: -122.42,
      country: "United States",
      state: "CA",
      count: 20
    },
    {
      lat: 34.05,
      lng: -118.24,
      country: "United States",
      state: "CA",
      count: 1
    },
    {
      lat: 45.52,
      lng: -122.68,
      country: "United States",
      state: "OR",
      count: 9
    },
    {
      lat: 47.37,
      lng: 8.54,
      country: "Switzerland",
      state: "Unknown",
      count: 2
    }
  ],
  mappedCount: 32,
  unmappedCount: 12,
  limitReached: false
};

// eslint-disable-next-line @lwc/lwc/no-async-operation
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

let mapMock;
let heatLayerMock;

function installLeafletMock() {
  mapMock = {
    setView: jest.fn(() => mapMock),
    fitBounds: jest.fn(),
    invalidateSize: jest.fn(),
    remove: jest.fn()
  };
  heatLayerMock = {
    addTo: jest.fn(() => heatLayerMock),
    setLatLngs: jest.fn(),
    setOptions: jest.fn()
  };
  window.L = {
    map: jest.fn(() => mapMock),
    tileLayer: jest.fn(() => ({ addTo: jest.fn() })),
    heatLayer: jest.fn(() => heatLayerMock),
    latLngBounds: jest.fn((latLngs) => ({ latLngs }))
  };
}

let globeMock;
let controlsMock;

function installGlobeMock() {
  controlsMock = {
    autoRotate: false,
    autoRotateSpeed: 0,
    listeners: {},
    addEventListener: jest.fn((type, fn) => {
      controlsMock.listeners[type] = fn;
    })
  };
  globeMock = {
    controls: jest.fn(() => controlsMock),
    pauseAnimation: jest.fn(),
    resumeAnimation: jest.fn(),
    _destructor: jest.fn()
  };
  [
    "globeImageUrl",
    "backgroundColor",
    "width",
    "height",
    "heatmapPointLat",
    "heatmapPointLng",
    "heatmapPointWeight",
    "heatmapBandwidth",
    "heatmapColorSaturation",
    "heatmapBaseAltitude",
    "heatmapTopAltitude",
    "heatmapsTransitionDuration",
    "heatmapsData",
    "pointOfView"
  ].forEach((method) => {
    globeMock[method] = jest.fn(() => globeMock);
  });
  window.Globe = jest.fn(() => globeMock);
}

async function createComponent(data = DATA) {
  const element = createElement("c-case-heat-map", { is: CaseHeatMap });
  document.body.appendChild(element);
  await flushPromises();
  if (data) {
    getCaseLocations.emit(data);
    await flushPromises();
  }
  return element;
}

const $ = (element, dataId) =>
  element.shadowRoot.querySelector(`[data-id="${dataId}"]`);
const summary = (element) => $(element, "summary")?.textContent;
const lastHeatPoints = () => heatLayerMock.setLatLngs.mock.calls.at(-1)[0];

async function fire(target, type, value) {
  target.dispatchEvent(new CustomEvent(type, { detail: { value } }));
  await flushPromises();
}

describe("c-case-heat-map", () => {
  beforeEach(() => {
    installLeafletMock();
    installGlobeMock();
    supportsWebGL.mockReturnValue(false);
  });

  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
    loadScript.mockResolvedValue();
    delete window.L;
    delete window.Globe;
    delete window.matchMedia;
  });

  describe("world view (AC 2, 3, 8, 11)", () => {
    it("loads Leaflet and the heat plugin, then shows a world map with OSM tiles", async () => {
      await createComponent();

      const scripts = loadScript.mock.calls.map((call) => call[1]);
      expect(scripts.some((url) => url.endsWith("/leaflet.js"))).toBe(true);
      expect(scripts.some((url) => url.endsWith("/leaflet-heat.js"))).toBe(
        true
      );
      expect(mapMock.setView).toHaveBeenCalledWith([20, 0], 2);
      const [tileUrl, tileOptions] = window.L.tileLayer.mock.calls[0];
      expect(tileUrl).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
      expect(tileOptions.attribution).toContain("OpenStreetMap");
    });

    it("plots every point weighted by its case count", async () => {
      await createComponent();

      expect(lastHeatPoints()).toEqual([
        [37.77, -122.42, 20],
        [34.05, -118.24, 1],
        [45.52, -122.68, 9],
        [47.37, 8.54, 2]
      ]);
      expect(heatLayerMock.setOptions).toHaveBeenLastCalledWith({ max: 20 });
    });

    it("shows mapped and unmapped counts as text", async () => {
      const element = await createComponent();

      expect(summary(element)).toBe("32 cases mapped · 12 not mapped");
    });

    it("offers countries ordered by case count", async () => {
      const element = await createComponent();

      expect($(element, "country").options).toEqual([
        { label: "United States (30)", value: "United States" },
        { label: "Switzerland (2)", value: "Switzerland" }
      ]);
      expect($(element, "state").disabled).toBe(true);
    });
  });

  describe("drill-down (AC 4, 5)", () => {
    it("drills into a country, then a state, and zooms to fit", async () => {
      const element = await createComponent();

      await fire($(element, "country"), "change", "United States");
      expect(summary(element)).toBe(
        "30 cases mapped in United States · 12 not mapped"
      );
      expect(lastHeatPoints()).toHaveLength(3);
      expect(mapMock.fitBounds).toHaveBeenCalledTimes(1);
      expect($(element, "state").disabled).toBe(false);
      expect($(element, "state").options).toEqual([
        { label: "CA (21)", value: "CA" },
        { label: "OR (9)", value: "OR" }
      ]);

      await fire($(element, "state"), "change", "OR");
      expect(summary(element)).toBe("9 cases mapped in OR · 12 not mapped");
      expect(lastHeatPoints()).toEqual([[45.52, -122.68, 9]]);
      expect(mapMock.fitBounds).toHaveBeenLastCalledWith(
        { latLngs: [[45.52, -122.68]] },
        expect.any(Object)
      );
    });

    it("shows breadcrumbs and navigates back up", async () => {
      const element = await createComponent();
      await fire($(element, "country"), "change", "United States");
      await fire($(element, "state"), "change", "CA");

      let crumbs = [
        ...element.shadowRoot.querySelectorAll("lightning-breadcrumb")
      ];
      expect(crumbs.map((c) => c.label)).toEqual([
        "World",
        "United States",
        "CA"
      ]);

      crumbs[1].click();
      await flushPromises();
      expect(summary(element)).toBe(
        "30 cases mapped in United States · 12 not mapped"
      );

      crumbs = [...element.shadowRoot.querySelectorAll("lightning-breadcrumb")];
      mapMock.setView.mockClear();
      crumbs[0].click();
      await flushPromises();
      expect(summary(element)).toBe("32 cases mapped · 12 not mapped");
      expect(mapMock.setView).toHaveBeenCalledWith([20, 0], 2);
      expect(
        element.shadowRoot.querySelectorAll("lightning-breadcrumb")
      ).toHaveLength(1);
    });

    it("returns to World when new filter results no longer include the selected country", async () => {
      const element = await createComponent();
      await fire($(element, "country"), "change", "Switzerland");

      getCaseLocations.emit({
        ...DATA,
        points: DATA.points.slice(0, 3),
        mappedCount: 30
      });
      await flushPromises();

      expect(summary(element)).toBe("30 cases mapped · 12 not mapped");
    });
  });

  describe("filters (AC 7)", () => {
    it("starts with no filters applied", async () => {
      await createComponent();

      expect(getCaseLocations.getLastConfig()).toEqual({
        statuses: [],
        priorities: [],
        startDate: null,
        endDate: null
      });
    });

    it("lists Status and Priority options from the picklists", async () => {
      const element = await createComponent();
      getObjectInfo.emit({ defaultRecordTypeId: "012000000000000AAA" });
      getPicklistValues.emit({
        values: [
          { label: "New", value: "New" },
          { label: "Working", value: "Working" }
        ]
      });
      await flushPromises();

      const items = $(element, "status-menu").querySelectorAll(
        "lightning-menu-item"
      );
      expect([...items].map((i) => i.value)).toEqual(["New", "Working"]);
    });

    it("re-queries when Status and Priority are toggled", async () => {
      const element = await createComponent();

      await fire($(element, "status-menu"), "select", "Working");
      await fire($(element, "status-menu"), "select", "New");
      await fire($(element, "priority-menu"), "select", "High");
      expect(getCaseLocations.getLastConfig()).toMatchObject({
        statuses: ["Working", "New"],
        priorities: ["High"]
      });
      expect($(element, "status-menu").label).toBe("Status (2)");

      await fire($(element, "status-menu"), "select", "Working");
      expect(getCaseLocations.getLastConfig().statuses).toEqual(["New"]);
    });

    it("re-queries with the date range and clears all filters", async () => {
      const element = await createComponent();
      expect($(element, "clear-filters").disabled).toBe(true);

      await fire($(element, "start-date"), "change", "2026-01-01");
      await fire($(element, "end-date"), "change", "2026-03-31");
      expect(getCaseLocations.getLastConfig()).toMatchObject({
        startDate: "2026-01-01",
        endDate: "2026-03-31"
      });
      expect($(element, "clear-filters").disabled).toBe(false);

      $(element, "clear-filters").click();
      await flushPromises();
      expect(getCaseLocations.getLastConfig()).toEqual({
        statuses: [],
        priorities: [],
        startDate: null,
        endDate: null
      });
    });

    it("treats a cleared date input as no filter", async () => {
      const element = await createComponent();

      await fire($(element, "start-date"), "change", "2026-01-01");
      await fire($(element, "start-date"), "change", "");
      expect(getCaseLocations.getLastConfig().startDate).toBeNull();
    });
  });

  describe("empty, error and limit states (AC 10)", () => {
    it("shows an empty state when no cases match", async () => {
      const element = await createComponent({
        points: [],
        mappedCount: 0,
        unmappedCount: 3,
        limitReached: false
      });

      expect($(element, "empty")).not.toBeNull();
      expect(summary(element)).toBe("0 cases mapped · 3 not mapped");
    });

    it("shows the Apex error message instead of the map", async () => {
      const element = await createComponent(null);
      getCaseLocations.error({
        message: "You do not have access to view Case locations."
      });
      await flushPromises();

      expect($(element, "error").textContent).toContain(
        "You do not have access to view Case locations."
      );
      expect($(element, "summary")).toBeNull();
      expect(element.shadowRoot.querySelector(".map").classList).toContain(
        "slds-hide"
      );
    });

    it("shows an error when the map library fails to load", async () => {
      loadScript.mockRejectedValue(new Error("blocked"));
      const element = await createComponent();

      expect($(element, "error").textContent).toContain(
        "Unable to load the map: blocked"
      );
      expect(window.L.map).not.toHaveBeenCalled();
    });

    it("warns when the row limit is reached", async () => {
      const element = await createComponent({ ...DATA, limitReached: true });

      expect($(element, "limit-warning")).not.toBeNull();
    });

    it("removes the map when the component is destroyed", async () => {
      const element = await createComponent();
      document.body.removeChild(element);

      expect(mapMock.remove).toHaveBeenCalled();
    });
  });

  describe("3D globe world view (KAN-8)", () => {
    const globeEl = (element) => element.shadowRoot.querySelector(".globe");
    const mapEl = (element) => element.shadowRoot.querySelector(".map");
    const lastGlobeData = () => globeMock.heatmapsData.mock.calls.at(-1)[0];

    beforeEach(() => {
      supportsWebGL.mockReturnValue(true);
    });

    it("shows the globe at World with every point weighted by case count (AC 1, 5)", async () => {
      const element = await createComponent();

      expect(window.Globe).toHaveBeenCalledWith(globeEl(element), {
        animateIn: false
      });
      const scripts = loadScript.mock.calls.map((call) => call[1]);
      expect(scripts.some((url) => url.endsWith("/globe.gl.min.js"))).toBe(
        true
      );
      expect(globeMock.globeImageUrl.mock.calls[0][0]).toMatch(
        /\/earth-dark\.jpg$/
      );
      expect(globeMock.heatmapPointWeight).toHaveBeenCalledWith("count");
      expect(lastGlobeData()).toEqual([DATA.points]);
      expect(globeEl(element).classList).not.toContain("slds-hide");
      expect(mapEl(element).classList).toContain("slds-hide");
    });

    it("updates the globe heat layer when filters return new data (AC 4)", async () => {
      await createComponent();

      getCaseLocations.emit({
        ...DATA,
        points: DATA.points.slice(3),
        mappedCount: 2
      });
      await flushPromises();

      expect(lastGlobeData()).toEqual([DATA.points.slice(3)]);

      getCaseLocations.emit({ ...DATA, points: [], mappedCount: 0 });
      await flushPromises();
      expect(lastGlobeData()).toEqual([]);
    });

    it("switches to the flat map on drill-down and back to the globe at World (AC 3)", async () => {
      const element = await createComponent();

      await fire($(element, "country"), "change", "United States");
      expect(globeEl(element).classList).toContain("slds-hide");
      expect(mapEl(element).classList).not.toContain("slds-hide");
      expect(globeMock.pauseAnimation).toHaveBeenCalledTimes(1);
      expect(mapMock.invalidateSize).toHaveBeenCalledTimes(1);
      expect(mapMock.fitBounds).toHaveBeenCalled();

      element.shadowRoot.querySelectorAll("lightning-breadcrumb")[0].click();
      await flushPromises();
      expect(globeEl(element).classList).not.toContain("slds-hide");
      expect(mapEl(element).classList).toContain("slds-hide");
      expect(globeMock.resumeAnimation).toHaveBeenCalledTimes(1);
    });

    it("auto-rotates slowly by default (AC 2)", async () => {
      await createComponent();

      expect(controlsMock.autoRotate).toBe(true);
      expect(controlsMock.autoRotateSpeed).toBeGreaterThan(0);
      expect(controlsMock.autoRotateSpeed).toBeLessThan(1);
    });

    it("pauses rotation while dragging and resumes after an idle delay (AC 2)", async () => {
      await createComponent();

      controlsMock.listeners.start();
      expect(controlsMock.autoRotate).toBe(false);

      jest.useFakeTimers();
      try {
        controlsMock.listeners.end();
        jest.advanceTimersByTime(2999);
        expect(controlsMock.autoRotate).toBe(false);
        jest.advanceTimersByTime(1);
        expect(controlsMock.autoRotate).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not auto-rotate when reduced motion is preferred (AC 7)", async () => {
      window.matchMedia = jest.fn((query) => ({
        matches: query === "(prefers-reduced-motion: reduce)"
      }));
      await createComponent();

      expect(controlsMock.autoRotate).toBe(false);

      jest.useFakeTimers();
      try {
        controlsMock.listeners.start();
        controlsMock.listeners.end();
        jest.advanceTimersByTime(10000);
        expect(controlsMock.autoRotate).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it.each([
      [
        "WebGL is unavailable",
        () => {
          supportsWebGL.mockReturnValue(false);
        }
      ],
      [
        "the globe library fails to load",
        () => {
          loadScript.mockImplementation((cmp, url) => {
            if (url.endsWith("/globe.gl.min.js")) {
              return Promise.reject(new Error("blocked"));
            }
            return Promise.resolve();
          });
        }
      ],
      [
        "the globe throws while starting",
        () => {
          window.Globe = jest.fn(() => {
            throw new Error("WebGL context lost");
          });
        }
      ]
    ])(
      "falls back to the flat map at World when %s (AC 6)",
      async (reason, arrange) => {
        arrange();
        const element = await createComponent();

        expect(globeEl(element).classList).toContain("slds-hide");
        expect(mapEl(element).classList).not.toContain("slds-hide");
        expect(mapMock.setView).toHaveBeenCalledWith([20, 0], 2);
        expect($(element, "error")).toBeNull();
        expect(summary(element)).toBe("32 cases mapped · 12 not mapped");
      }
    );

    it("destroys the globe when the component is removed", async () => {
      const element = await createComponent();
      document.body.removeChild(element);

      expect(globeMock._destructor).toHaveBeenCalled();
      expect(mapMock.remove).toHaveBeenCalled();
    });
  });
});
