import { ZodTypeAny, z } from 'zod';

// Minimal zod -> JSON Schema converter for the tool input shapes we use.
// We only need strict object schemas with primitive leaves + optional.
export function zodToJsonSchema(schema: ZodTypeAny): any {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as any)._def.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape) as [string, ZodTypeAny][]) {
      const { json, isOptional } = unwrap(val);
      properties[key] = json;
      if (!isOptional) required.push(key);
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    };
  }
  return unwrap(schema).json;
}

function unwrap(val: ZodTypeAny): { json: any; isOptional: boolean } {
  let isOptional = false;
  let inner = val;
  while (
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodDefault ||
    inner instanceof z.ZodNullable
  ) {
    isOptional = isOptional || inner instanceof z.ZodOptional || inner instanceof z.ZodDefault;
    inner = (inner as any)._def.innerType;
  }
  if (inner instanceof z.ZodString) return { json: { type: 'string' }, isOptional };
  if (inner instanceof z.ZodNumber) {
    const checks = (inner as any)._def.checks || [];
    const out: any = { type: 'number' };
    for (const c of checks) {
      if (c.kind === 'int') out.type = 'integer';
      if (c.kind === 'min') out.minimum = c.value;
      if (c.kind === 'max') out.maximum = c.value;
    }
    return { json: out, isOptional };
  }
  if (inner instanceof z.ZodBoolean) return { json: { type: 'boolean' }, isOptional };
  if (inner instanceof z.ZodObject) return { json: zodToJsonSchema(inner), isOptional };
  if (inner instanceof z.ZodArray) {
    return {
      json: { type: 'array', items: zodToJsonSchema((inner as any)._def.type) },
      isOptional,
    };
  }
  if (inner instanceof z.ZodEnum) {
    return { json: { type: 'string', enum: (inner as any)._def.values }, isOptional };
  }
  if (inner instanceof z.ZodRecord) {
    return { json: { type: 'object', additionalProperties: true }, isOptional };
  }
  if (inner instanceof z.ZodUnknown || inner instanceof z.ZodAny) {
    return { json: {}, isOptional };
  }
  return { json: {}, isOptional };
}
