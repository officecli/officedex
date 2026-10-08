import type {
  VibeChart,
  VibeChartOptions,
  VibeChartGenerationSpec,
  VibeChartSeries,
  VibeChartType,
} from "./types";

const DEFAULT_CHART_TYPE: VibeChartType = "column";
const CHART_TYPES = new Set([
  "column",
  "bar",
  "line",
  "area",
  "pie",
  "donut",
  "radar",
  "scatter",
  "combo",
]);

export class VibeChartModelError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "VibeChartModelError";
    this.path = path;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new VibeChartModelError(path, "must be an array of strings");
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new VibeChartModelError(`${path}[${index}]`, "must be a non-empty string");
    }
    return item;
  });
}

function numberArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VibeChartModelError(path, "must be a non-empty array of numbers");
  }
  return value.map((item, index) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new VibeChartModelError(`${path}[${index}]`, "must be a finite number");
    }
    return item;
  });
}

function normalizeSeries(value: unknown, path: string): VibeChartSeries[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new VibeChartModelError(path, "must contain at least one series");
  }
  return value.map((item, index) => {
    const series = recordValue(item);
    const name =
      typeof series.name === "string" && series.name.trim().length > 0
        ? series.name
        : `系列 ${index + 1}`;
    const values = numberArray(series.values, `${path}[${index}].values`);
    const axis =
      series.axis === "secondary" ? "secondary" : "primary";
    const chartType =
      typeof series.chartType === "string" &&
      series.chartType !== "combo" &&
      CHART_TYPES.has(series.chartType)
        ? (series.chartType as Exclude<VibeChartType, "combo">)
        : undefined;
    return {
      name,
      values,
      ...(typeof series.color === "string" && series.color.trim()
        ? { color: series.color }
        : {}),
      axis,
      ...(chartType ? { chartType } : {}),
    };
  });
}

function assertSeriesLengths(
  series: readonly VibeChartSeries[],
  path: string,
): number {
  const length = series[0]?.values.length ?? 0;
  if (length === 0) {
    throw new VibeChartModelError(path, "must contain at least one data point");
  }
  if (series.some((item) => item.values.length !== length)) {
    throw new VibeChartModelError(
      path,
      "every series must contain the same number of values",
    );
  }
  return length;
}

function normalizeOptions(value: unknown): VibeChartOptions | undefined {
  if (value === undefined) return undefined;
  const raw = recordValue(value);
  const legend =
    raw.legend === "none" ||
    raw.legend === "top" ||
    raw.legend === "bottom" ||
    raw.legend === "left" ||
    raw.legend === "right"
      ? raw.legend
      : undefined;
  const dataLabels =
    raw.dataLabels === "none" ||
    raw.dataLabels === "value" ||
    raw.dataLabels === "percent"
      ? raw.dataLabels
      : undefined;
  const legendVisible =
    typeof raw.legendVisible === "boolean"
      ? raw.legendVisible
      : legend === "none"
        ? false
        : legend
          ? true
          : undefined;
  const showValueLabels =
    typeof raw.showValueLabels === "boolean"
      ? raw.showValueLabels
      : dataLabels !== undefined
        ? dataLabels !== "none"
        : undefined;
  return {
    ...(legendVisible === undefined ? {} : { legendVisible }),
    ...(legend && legend !== "none" ? { legendPosition: legend } : {}),
    ...(showValueLabels === undefined ? {} : { showValueLabels }),
    ...(typeof raw.stacked === "boolean" ? { stacked: raw.stacked } : {}),
    ...(typeof raw.markers === "boolean" ? { markers: raw.markers } : {}),
    ...(typeof raw.smooth === "boolean" ? { smooth: raw.smooth } : {}),
    ...(legend ? { legend } : {}),
    ...(dataLabels ? { dataLabels } : {}),
    ...(typeof raw.yAxisLabel === "string"
      ? { yAxisLabel: raw.yAxisLabel }
      : {}),
    ...(typeof raw.secondaryAxisLabel === "string"
      ? { secondaryAxisLabel: raw.secondaryAxisLabel }
      : {}),
  };
}

export function normalizeVibeChart(
  value: unknown,
  path = "chart",
): VibeChart {
  const raw = recordValue(value);
  let type: VibeChartType = DEFAULT_CHART_TYPE;
  if (raw.type !== undefined) {
    if (typeof raw.type !== "string" || !CHART_TYPES.has(raw.type)) {
      throw new VibeChartModelError(
        `${path}.type`,
        "must be one of the supported native chart types",
      );
    }
    type = raw.type as VibeChartType;
  }
  const categories = stringArray(raw.categories, `${path}.categories`);
  const series = raw.series !== undefined
    ? normalizeSeries(raw.series, `${path}.series`)
    : normalizeSeries(
        [
          {
            name: "系列 1",
            values: raw.values,
          },
        ],
        `${path}.values`,
      );
  const pointCount = assertSeriesLengths(series, `${path}.series`);
  if (categories && series.some((item) => item.values.length !== categories.length)) {
    throw new VibeChartModelError(
      path,
      "categories and every series must have the same length",
    );
  }
  const source = recordValue(raw.source);
  const sourceKind =
    typeof source.kind === "string" && source.kind.trim().length > 0
      ? source.kind
      : "manual";
  return {
    type,
    ...(typeof raw.title === "string" && raw.title.trim()
      ? { title: raw.title }
      : {}),
    ...(categories ? { categories } : {}),
    ...(!categories
      ? {
          categories: Array.from(
            { length: pointCount },
            (_, index) => String(index + 1),
          ),
        }
      : {}),
    series,
    ...(normalizeOptions(raw.options)
      ? { options: normalizeOptions(raw.options) }
      : {}),
    source: {
      kind: sourceKind,
      ...(typeof source.ref === "string" && source.ref.trim()
        ? { ref: source.ref }
        : {}),
    },
    ...(raw.illustrative === true ? { illustrative: true } : {}),
  };
}

export type JssdkChartCell = string | number;

/**
 * Convert the neutral OfficeDex chart model to the matrix accepted by the
 * public PowerPoint ShapeCollection.addChart API.
 */
export function vibeChartToJssdkMatrix(
  value: VibeChart,
): JssdkChartCell[][] {
  const chart = normalizeVibeChart(value);
  return [
    ["", ...(chart.categories ?? [])],
    ...(chart.series ?? []).map((series) => [series.name, ...series.values]),
  ];
}

export function chartGenerationSpec(
  value: VibeChart,
  relation:
    | "trend"
    | "comparison"
    | "distribution"
    | "correlation"
    | "other" = "other",
): VibeChartGenerationSpec {
  const chart = normalizeVibeChart(value);
  const visualRole: VibeChartGenerationSpec["visualRole"] =
    chart.type === "pie" || chart.type === "donut"
      ? "chart"
      : "chart";
  const area =
    relation === "comparison" || relation === "distribution"
      ? "right"
      : relation === "correlation"
        ? "center"
        : "right";
  return {
    visualRole,
    chartType: chart.type ?? DEFAULT_CHART_TYPE,
    dataSource: {
      kind: chart.source?.kind ?? "manual",
      ...(chart.source?.ref ? { ref: chart.source.ref } : {}),
    },
    focalPoint: {
      kind: "chart",
      area,
      weight: relation === "distribution" ? 0.56 : 0.62,
    },
    contentBudget: {
      titleChars: chart.title?.length ?? 0,
      categories: chart.categories?.length ?? 0,
      series: chart.series?.length ?? 0,
      annotationLines: chart.options?.showValueLabels ? 1 : 3,
    },
    illustrative: chart.illustrative === true,
  };
}
