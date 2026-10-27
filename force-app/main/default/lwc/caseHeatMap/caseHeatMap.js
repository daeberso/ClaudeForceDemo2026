import { LightningElement, wire } from "lwc";
import { loadScript, loadStyle } from "lightning/platformResourceLoader";
import { getObjectInfo, getPicklistValues } from "lightning/uiObjectInfoApi";
import LEAFLET from "@salesforce/resourceUrl/leaflet";
import CASE_OBJECT from "@salesforce/schema/Case";
import STATUS_FIELD from "@salesforce/schema/Case.Status";
import PRIORITY_FIELD from "@salesforce/schema/Case.Priority";
import getCaseLocations from "@salesforce/apex/CaseHeatMapController.getCaseLocations";

const WORLD_CENTER = [20, 0];
const WORLD_ZOOM = 2;
// Keeps a drilled-in area with a single Case at roughly city level.
const MAX_FIT_ZOOM = 7;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function reduceError(error) {
  if (Array.isArray(error?.body)) {
    return error.body.map((e) => e.message).join(", ");
  }
  return error?.body?.message ?? error?.message ?? "Unknown error";
}

function toOptions(values) {
  return [...values.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ label: `${value} (${count})`, value }));
}

export default class CaseHeatMap extends LightningElement {
  // Filters (null means "not applied"; wire params must not be undefined)
  selectedStatuses = [];
  selectedPriorities = [];
  startDate = null;
  endDate = null;

  // Drill-down
  selectedCountry = null;
  selectedState = null;

  statusValues = [];
  priorityValues = [];
  data;
  dataError;
  libraryError;
  isLoading = true;

  map;
  heatLayer;
  leafletRequested = false;

  @wire(getObjectInfo, { objectApiName: CASE_OBJECT })
  objectInfo;

  @wire(getPicklistValues, {
    recordTypeId: "$objectInfo.data.defaultRecordTypeId",
    fieldApiName: STATUS_FIELD
  })
  wiredStatuses({ data }) {
    if (data) {
      this.statusValues = data.values.map((v) => ({
        label: v.label,
        value: v.value
      }));
    }
  }

  @wire(getPicklistValues, {
    recordTypeId: "$objectInfo.data.defaultRecordTypeId",
    fieldApiName: PRIORITY_FIELD
  })
  wiredPriorities({ data }) {
    if (data) {
      this.priorityValues = data.values.map((v) => ({
        label: v.label,
        value: v.value
      }));
    }
  }

  @wire(getCaseLocations, {
    statuses: "$selectedStatuses",
    priorities: "$selectedPriorities",
    startDate: "$startDate",
    endDate: "$endDate"
  })
  wiredLocations({ data, error }) {
    if (data) {
      this.data = data;
      this.dataError = undefined;
      this.isLoading = false;
      this.resetDrillIfMissing();
      this.updateMap(true);
    } else if (error) {
      this.data = undefined;
      this.dataError = reduceError(error);
      this.isLoading = false;
    }
  }

  renderedCallback() {
    if (this.leafletRequested) {
      return;
    }
    this.leafletRequested = true;
    Promise.all([
      loadScript(this, `${LEAFLET}/leaflet.js`),
      loadStyle(this, `${LEAFLET}/leaflet.css`)
    ])
      .then(() => loadScript(this, `${LEAFLET}/leaflet-heat.js`))
      .then(() => this.initMap())
      .catch((error) => {
        this.libraryError = `Unable to load the map: ${reduceError(error)}`;
      });
  }

  disconnectedCallback() {
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
  }

  initMap() {
    const L = window.L;
    const container = this.template.querySelector(".map");
    this.map = L.map(container, { worldCopyJump: true }).setView(
      WORLD_CENTER,
      WORLD_ZOOM
    );
    L.tileLayer(TILE_URL, { maxZoom: 18, attribution: TILE_ATTRIBUTION }).addTo(
      this.map
    );
    this.heatLayer = L.heatLayer([], {
      radius: 25,
      blur: 18,
      maxZoom: 10
    }).addTo(this.map);
    this.updateMap(true);
  }

  updateMap(refit) {
    if (!this.map || !this.heatLayer) {
      return;
    }
    const points = this.visiblePoints;
    const max = points.reduce((m, p) => Math.max(m, p.count), 1);
    this.heatLayer.setOptions({ max });
    this.heatLayer.setLatLngs(points.map((p) => [p.lat, p.lng, p.count]));
    if (!refit) {
      return;
    }
    if (this.level === "world" || points.length === 0) {
      this.map.setView(WORLD_CENTER, WORLD_ZOOM);
    } else {
      const bounds = window.L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      this.map.fitBounds(bounds, { padding: [30, 30], maxZoom: MAX_FIT_ZOOM });
    }
  }

  resetDrillIfMissing() {
    const points = this.data?.points ?? [];
    if (
      this.selectedCountry &&
      !points.some((p) => p.country === this.selectedCountry)
    ) {
      this.selectedCountry = null;
      this.selectedState = null;
    } else if (
      this.selectedState &&
      !points.some(
        (p) =>
          p.country === this.selectedCountry && p.state === this.selectedState
      )
    ) {
      this.selectedState = null;
    }
  }

  // ---------- Derived state ----------

  get level() {
    if (this.selectedState) {
      return "state";
    }
    return this.selectedCountry ? "country" : "world";
  }

  get visiblePoints() {
    const points = this.data?.points ?? [];
    return points.filter(
      (p) =>
        (!this.selectedCountry || p.country === this.selectedCountry) &&
        (!this.selectedState || p.state === this.selectedState)
    );
  }

  get countryOptions() {
    const counts = new Map();
    (this.data?.points ?? []).forEach((p) =>
      counts.set(p.country, (counts.get(p.country) ?? 0) + p.count)
    );
    return toOptions(counts);
  }

  get stateOptions() {
    const counts = new Map();
    (this.data?.points ?? [])
      .filter((p) => p.country === this.selectedCountry)
      .forEach((p) =>
        counts.set(p.state, (counts.get(p.state) ?? 0) + p.count)
      );
    return toOptions(counts);
  }

  get isStatePickerDisabled() {
    return !this.selectedCountry;
  }

  get breadcrumbs() {
    const crumbs = [{ name: "world", label: "World" }];
    if (this.selectedCountry) {
      crumbs.push({ name: "country", label: this.selectedCountry });
    }
    if (this.selectedState) {
      crumbs.push({ name: "state", label: this.selectedState });
    }
    return crumbs;
  }

  get statusMenuItems() {
    return this.statusValues.map((o) => ({
      ...o,
      checked: this.selectedStatuses.includes(o.value)
    }));
  }

  get priorityMenuItems() {
    return this.priorityValues.map((o) => ({
      ...o,
      checked: this.selectedPriorities.includes(o.value)
    }));
  }

  get statusMenuLabel() {
    return this.selectedStatuses.length
      ? `Status (${this.selectedStatuses.length})`
      : "Status: All";
  }

  get priorityMenuLabel() {
    return this.selectedPriorities.length
      ? `Priority (${this.selectedPriorities.length})`
      : "Priority: All";
  }

  get hasActiveFilters() {
    return Boolean(
      this.selectedStatuses.length ||
      this.selectedPriorities.length ||
      this.startDate ||
      this.endDate
    );
  }

  get isClearDisabled() {
    return !this.hasActiveFilters;
  }

  get mappedCount() {
    return this.visiblePoints.reduce((sum, p) => sum + p.count, 0);
  }

  get unmappedCount() {
    return this.data?.unmappedCount ?? 0;
  }

  get summaryText() {
    const area = this.selectedState ?? this.selectedCountry;
    const mapped = `${this.mappedCount} ${this.mappedCount === 1 ? "case" : "cases"} mapped`;
    return `${mapped}${area ? ` in ${area}` : ""} · ${this.unmappedCount} not mapped`;
  }

  get limitReached() {
    return Boolean(this.data?.limitReached);
  }

  get errorMessage() {
    return this.dataError ?? this.libraryError;
  }

  get hasData() {
    return Boolean(this.data) && !this.errorMessage;
  }

  get isEmpty() {
    return this.hasData && this.visiblePoints.length === 0;
  }

  get mapClass() {
    return this.errorMessage ? "map slds-hide" : "map";
  }

  // ---------- Handlers ----------

  handleStatusSelect(event) {
    this.selectedStatuses = this.toggle(
      this.selectedStatuses,
      event.detail.value
    );
  }

  handlePrioritySelect(event) {
    this.selectedPriorities = this.toggle(
      this.selectedPriorities,
      event.detail.value
    );
  }

  toggle(list, value) {
    this.isLoading = true;
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  handleStartDateChange(event) {
    this.isLoading = true;
    this.startDate = event.detail.value || null;
  }

  handleEndDateChange(event) {
    this.isLoading = true;
    this.endDate = event.detail.value || null;
  }

  handleClearFilters() {
    this.isLoading = true;
    this.selectedStatuses = [];
    this.selectedPriorities = [];
    this.startDate = null;
    this.endDate = null;
  }

  handleCountryChange(event) {
    this.selectedCountry = event.detail.value || null;
    this.selectedState = null;
    this.updateMap(true);
  }

  handleStateChange(event) {
    this.selectedState = event.detail.value || null;
    this.updateMap(true);
  }

  handleBreadcrumbClick(event) {
    event.preventDefault();
    const name = event.currentTarget.name;
    if (name === "world") {
      this.selectedCountry = null;
      this.selectedState = null;
    } else if (name === "country") {
      this.selectedState = null;
    }
    this.updateMap(true);
  }
}
