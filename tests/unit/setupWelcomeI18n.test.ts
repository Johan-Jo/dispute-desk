import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";

describe("Setup welcome i18n keys", () => {
  const welcome = (enMessages as any).setup?.welcome;

  it("setup.welcome namespace exists", () => {
    expect(welcome).toBeDefined();
  });

  const requiredKeys = [
    "title",
    "subtitle",
    "benefitAutoTitle",
    "benefitAutoDesc",
    "benefitWinTitle",
    "benefitWinDesc",
    "benefitTimeTitle",
    "benefitTimeDesc",
    "expectTitle",
    "step1Title",
    "step1Desc",
    "step2Title",
    "step2Desc",
    "step3Title",
    "step3Desc",
    "step4Title",
    "step4Desc",
    "step5Title",
    "step5Desc",
    "getStarted",
    "timeEstimate",
    "adjustLater",
    "skipSetup",
  ];

  it.each(requiredKeys)("has key: setup.welcome.%s", (key) => {
    expect(welcome[key]).toBeDefined();
    expect(typeof welcome[key]).toBe("string");
    expect(welcome[key].length).toBeGreaterThan(0);
  });

  it("has all 5 step titles and descriptions", () => {
    for (let i = 1; i <= 5; i++) {
      expect(welcome[`step${i}Title`]).toBeDefined();
      expect(welcome[`step${i}Desc`]).toBeDefined();
    }
  });
});
