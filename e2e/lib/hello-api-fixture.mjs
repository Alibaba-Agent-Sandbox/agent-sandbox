import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Explicit client contract for the existing python-hello Server SDK fixture.
// Declaring these routes does not install or start the application.
export const HELLO_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'E2E hello application', version: '1.0.0' },
  security: [{ token: [] }],
  paths: {
    '/commands': {
      get: {
        operationId: 'catalog',
        summary: 'Read the deployed application command catalog',
        responses: { '200': { description: 'Registered commands' } },
      },
    },
    '/commands/hello': {
      post: {
        operationId: 'hello',
        summary: 'Say hello',
        requestBody: {
          content: { 'application/json': { schema: {
            type: 'object', additionalProperties: false,
            properties: { name: { type: 'string' } },
          } } },
        },
        responses: { '200': { description: 'Hello result' } },
      },
    },
  },
  components: { securitySchemes: { token: { type: 'http', scheme: 'bearer' } } },
};

export const HELLO_REGISTRY = {
  apis: { app: { resource: 'sandbox.app', port: 9000, openapi: './openapi.json' } },
};

export function writeHelloApiFixture(directory) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'openapi.json'), JSON.stringify(HELLO_OPENAPI, null, 2) + '\n');
  const registry = join(directory, 'registry.yaml');
  writeFileSync(registry, JSON.stringify(HELLO_REGISTRY, null, 2) + '\n');
  return registry;
}
