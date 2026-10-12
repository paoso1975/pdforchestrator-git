import assert from "node:assert/strict";
import { test } from "node:test";
import { describeHealthVariable, serviceHealthSchema } from "./admin-service-health-schema";

test("diagnostic variable helper redacts secrets and resolves aliases", () => {
  const secret = "s3cr3t-value-that-must-not-leak";
  const variable = describeHealthVariable({ CUBBIT_KEY: secret }, "S3_ACCESS_KEY_ID", { aliases: ["CUBBIT_KEY"], sensitive: true });
  assert.equal(variable.name, "CUBBIT_KEY");
  assert.equal(variable.configured, true);
  assert.equal(variable.value, "Configurata · valore nascosto");
  assert.equal(JSON.stringify(variable).includes(secret), false);
});

test("diagnostic response validates the safe representation of sensitive variables", () => {
  const response = {
    checkedAt: new Date().toISOString(),
    services: [{ id: "s3", label: "S3", status: "ok", message: "Accesso riuscito", durationMs: 3, variables: [{ name: "S3_SECRET_ACCESS_KEY", configured: true, value: "Configurata · valore nascosto", sensitive: true }], details: [] }],
  };
  const parsed = serviceHealthSchema.parse(response);
  const safeVariable = describeHealthVariable({ S3_SECRET_ACCESS_KEY: "raw-secret" }, "S3_SECRET_ACCESS_KEY", { sensitive: true });
  parsed.services[0]!.variables[0] = safeVariable;
  assert.equal(JSON.stringify(parsed).includes("raw-secret"), false);
});

test("unset variables are explicitly represented", () => {
  assert.deepEqual(describeHealthVariable({}, "DATABASE_URL"), { name: "DATABASE_URL", configured: false, value: null, sensitive: false });
});
