import { afterEach, beforeEach, expect, it } from "vitest";

import { planModeRequested } from "./planMode";

/**
 * The switch that makes the outline gate reachable at all.
 *
 * What matters most here is the default. The gate puts a mandatory pause in
 * front of every deck, so a switch that is on when nobody asked — or that reads
 * as on from a stray value — changes the product for everyone by accident.
 */
const url = (search: string) => {
  Object.defineProperty(window, "location", {
    value: { ...window.location, search },
    configurable: true,
  });
};

beforeEach(() => {
  localStorage.clear();
  url("");
});

afterEach(() => {
  localStorage.clear();
});

it("is off when nobody asked", () => {
  expect(planModeRequested()).toBe(false);
});

it("is off for anything that is not an explicit 1", () => {
  for (const value of ["", "0", "true", "yes", "plan", "2"]) {
    url(`?planMode=${value}`);
    expect(planModeRequested(), `?planMode=${value} should not opt in`).toBe(false);
  }
  for (const value of ["", "0", "true", "yes"]) {
    url("");
    localStorage.setItem("officedex.planMode", value);
    expect(planModeRequested(), `localStorage ${value} should not opt in`).toBe(false);
  }
});

it("is on when the URL asks", () => {
  url("?planMode=1");
  expect(planModeRequested()).toBe(true);
});

/* A packaged app has no address bar; its DevTools can still reach storage. */
it("is on when storage asks, for a build with no URL to edit", () => {
  localStorage.setItem("officedex.planMode", "1");
  expect(planModeRequested()).toBe(true);
});

/*
 * The URL is the more deliberate of the two — it is typed for this run — so it
 * decides, including when it is turning the thing off.
 */
it("lets the URL turn off what storage turned on", () => {
  localStorage.setItem("officedex.planMode", "1");
  url("?planMode=0");
  expect(planModeRequested()).toBe(false);
});
