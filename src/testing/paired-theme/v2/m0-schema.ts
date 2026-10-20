import {readFile} from 'node:fs/promises';

import Ajv2020, {type AnySchema, type ErrorObject} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/** Execute the committed JSON Schema before the stricter semantic validator. */
export async function assertM0V2JsonSchema(
  schemaPath: string,
  value: unknown,
  label: string,
): Promise<void> {
  let schema: unknown;
  try {
    schema = JSON.parse(await readFile(schemaPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} schema cannot be loaded`, {cause: error});
  }
  const ajv = new Ajv2020({allErrors: true, strict: true, validateFormats: true});
  addFormats(ajv, {mode: 'full'});
  const validate = ajv.compile(schema as AnySchema);
  if (!validate(value)) {
    throw new Error(`${label} violates JSON Schema: ${formatErrors(validate.errors)}`);
  }
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'unknown validation error';
  return errors.map((error) =>
    `${error.instancePath || '/'} ${error.message ?? error.keyword}`).join('; ');
}
