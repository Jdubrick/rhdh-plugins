/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  coreServices,
  createBackendPlugin,
  LoggerService,
} from '@backstage/backend-plugin-api';
import {
  CatalogService,
  catalogServiceRef,
} from '@backstage/plugin-catalog-node';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { Entity } from '@backstage/catalog-model';
import { CatalogClient } from '@backstage/catalog-client';
import { createPermission } from '@backstage/plugin-permission-common';
import { AuthorizeResult } from '@backstage/plugin-permission-common';

/**
 * Permission for fetching catalog entities via MCP tool
 * @public
 */
export const catalogMcpFetchPermission = createPermission({
  name: 'catalog.mcp.fetch',
  attributes: { action: 'read' },
});

/**
 * Permission for deleting catalog entities via MCP tool
 * @public
 */
export const catalogMcpDeletePermission = createPermission({
  name: 'catalog.mcp.delete',
  attributes: { action: 'delete' },
});

/**
 * backstageMcpPlugin backend plugin
 *
 * @public
 */
export const backstageMcpPlugin = createBackendPlugin({
  pluginId: 'software-catalog-mcp-tool',
  register(env) {
    env.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        catalog: catalogServiceRef,
        auth: coreServices.auth,
        permissions: coreServices.permissions,
        discovery: coreServices.discovery,
      },
      // Sample action used in the Backstage docs: https://github.com/backstage/backstage/tree/master/plugins/mcp-actions-backend
      async init({
        actionsRegistry,
        catalog,
        auth,
        logger,
        permissions,
        discovery,
      }) {
        // This action is used to fetch the list of catalog entities from Backstage. It returns an array of entity names
        actionsRegistry.register({
          name: 'fetch-catalog-entities',
          title: 'Fetch Catalog Entities',
          description: `Search and retrieve catalog entities from the Backstage server.

List all Backstage entities such as Components, Systems, Resources, APIs, Locations, Users, and Groups. 
By default, results are returned in JSON array format, where each entry in the JSON array is an entity with the following fields: 'name', 'description','type', 'owner', 'tags', 'dependsOn' and 'kind'.
Setting 'verbose' to true will return the full Backstage entity objects, but should only be used if the reduced output is not sufficient, as this will significantly impact context usage (especially on smaller models).
Note: 'type' can only be filtered on if a specified entity 'kind' is also specified.

Example invocations and the output from those invocations:
  # Find all Resources of type storage
  fetch-catalog-entities kind:Resource type:storage
  Output: {
  "entities": [
    {
      "name": "ibm-granite-s3-bucket",
      "kind": "Resource",
      "type": "storage",
      "tags": [
        "genai",
        "ibm",
        "llm",
        "granite",
        "conversational",
        "task-text-generation"
      ]
    }
  ]


`,
          // End tool description
          schema: {
            input: z =>
              z.object({
                kind: z
                  .string()
                  .optional()
                  .describe(
                    'Filter entities by kind (e.g., Component, API, System)',
                  ),
                type: z
                  .string()
                  .optional()
                  .describe(
                    'Filter entities by type (e.g., ai-model, library, website).',
                  ),
                name: z.string().optional().describe('Filter entities by name'),
                owner: z
                  .string()
                  .optional()
                  .describe(
                    'Filter entities by owner (e.g., team-platform, user:john.doe)',
                  ),
                lifecycle: z
                  .string()
                  .optional()
                  .describe(
                    'Filter entities by lifecycle (e.g., production, staging, development)',
                  ),
                tags: z // Don't define using arrays - some mcp clients (notably llama stack) have issues decoding them (more investigation needed)
                  .string()
                  .optional()
                  .describe(
                    'Filter entities by tags as comma-separated values (e.g., "genai,ibm,llm,granite,conversational,task-text-generation")',
                  ),
                verbose: z
                  .boolean()
                  .optional()
                  .describe(
                    'If true, returns the full Backstage Entity object from the API rather than the shortened output.',
                  ),
              }),
            output: z =>
              z.object({
                entities: z
                  .array(
                    z.union([
                      z.object({
                        name: z
                          .string()
                          .describe(
                            'The name field for each Backstage entity in the catalog',
                          ),
                        kind: z
                          .string()
                          .describe(
                            'The kind/type of the Backstage entity (e.g., Component, API, System)',
                          ),
                        tags: z
                          .string()
                          .optional()
                          .describe(
                            'The tags associated with the Backstage entity as comma-separated values',
                          ),
                        description: z
                          .string()
                          .optional()
                          .describe('The description of the Backstage entity'),
                        type: z
                          .string()
                          .optional()
                          .describe(
                            'The type of the Backstage entity (e.g., service, library, website)',
                          ),
                        owner: z
                          .string()
                          .optional()
                          .describe(
                            'The owner of the Backstage entity (e.g., team-platform, user:john.doe)',
                          ),
                        lifecycle: z
                          .string()
                          .optional()
                          .describe(
                            'The lifecycle of the Backstage entity (e.g., production, staging, development)',
                          ),
                        dependsOn: z
                          .string()
                          .optional()
                          .describe(
                            'List of entities this entity depends on as comma-separated values (e.g., "component:default/database,api:default/external-service")',
                          ),
                      }),
                      z.custom<Entity>(),
                    ]),
                  )
                  .describe(
                    'An array of entities (either Backstage Entity objects or shortened entity information based on verbose parameter)',
                  ),
                error: z
                  .string()
                  .optional()
                  .describe('Error message if validation fails'),
              }),
          },
          action: async ({ input, credentials }) => {
            // Check permissions - Note: In MCP actions, credentials come from the MCP server's authentication
            // This requires the permission framework to be enabled and configured
            if (credentials) {
              const principal = credentials.principal as any;
              const principalStr = String(principal?.userEntityRef ?? principal ?? 'unknown');
              
              logger.info(
                'fetch-catalog-entities: Checking permissions for user',
                {
                  principal: principalStr,
                  ...(process.env.LOG_FULL_CREDENTIALS === 'true' && {
                    credentials: JSON.stringify(credentials, null, 2),
                  }),
                },
              );

              try {
                const decision = (
                  await permissions.authorize(
                    [{ permission: catalogMcpFetchPermission }],
                    { credentials },
                  )
                )[0];

                logger.info(
                  'fetch-catalog-entities: Permission authorization decision',
                  {
                    permission: catalogMcpFetchPermission.name,
                    result: decision.result,
                    principal: principalStr,
                  },
                );

                if (decision.result !== AuthorizeResult.ALLOW) {
                  logger.warn(
                    'fetch-catalog-entities: Permission denied',
                    {
                      permission: catalogMcpFetchPermission.name,
                      result: decision.result,
                      principal: principalStr,
                    },
                  );
                  return {
                    output: {
                      entities: [],
                      error:
                        'Permission denied: You do not have permission to fetch catalog entities',
                    },
                  };
                }

                logger.info(
                  'fetch-catalog-entities: Permission granted',
                  {
                    principal: principalStr,
                  },
                );
              } catch (error) {
                logger.warn(
                  'fetch-catalog-entities: Permission check failed, allowing by default',
                  {
                    error: (error as Error).message,
                    principal: principalStr,
                  },
                );
                // If permissions are not configured, allow by default for backwards compatibility
              }
            } else {
              logger.info(
                'fetch-catalog-entities: No credentials provided, proceeding without auth check',
              );
            }

            // Validate that type is only used with kind -- we could just allow `type` to be specified without `kind` but given types are per kind it made sense to restrict it
            // The Backstage MCP server will return a 500 error if we throw a validation error (without saying why), so instead, let's return the error message in the output
            // TODO: Investigate potential upstream improvements to allow error messages to be returned to the client
            if (input.type && !input.kind) {
              return {
                output: {
                  entities: [],
                  error:
                    'entity type cannot be specified without an entity kind specified',
                },
              };
            }
            try {
              const result = await fetchCatalogEntities(
                catalog,
                auth,
                logger,
                input,
              );
              return {
                output: {
                  ...result,
                  error: undefined,
                },
              };
            } catch (error) {
              logger.error(
                'fetch-catalog-entities: Error fetching catalog entities:',
                error,
              );
              return {
                output: {
                  entities: [],
                  error: error.message,
                },
              };
            }
          },
        });

        // This action is used to delete catalog entities from Backstage
        actionsRegistry.register({
          name: 'delete-catalog-entity',
          title: 'Delete Catalog Entity',
          description: `Delete a catalog entity from the Backstage server by its entity reference.

This action permanently removes an entity from the catalog. Use with caution.
The entity reference should be in the format: [kind]:[namespace]/[name] (e.g., "Component:default/my-service")

Example invocations:
  # Delete a Component entity
  delete-catalog-entity entityRef:Component:default/my-service
  
  # Delete a Resource entity
  delete-catalog-entity entityRef:Resource:default/my-database

Returns:
  - success: true if the entity was deleted successfully
  - message: A confirmation message
  - error: An error message if the deletion failed
`,
          schema: {
            input: z =>
              z.object({
                entityRef: z
                  .string()
                  .describe(
                    'The entity reference in the format: [kind]:[namespace]/[name] (e.g., "Component:default/my-service")',
                  ),
              }),
            output: z =>
              z.object({
                success: z
                  .boolean()
                  .describe('Whether the entity was deleted successfully'),
                message: z
                  .string()
                  .optional()
                  .describe('A message describing the result'),
                error: z
                  .string()
                  .optional()
                  .describe('Error message if the deletion failed'),
              }),
          },
          action: async ({ input, credentials }) => {
            // Check permissions - only users with delete permission can use this action
            if (credentials) {
              const principal = credentials.principal as any;
              const principalStr = String(principal?.userEntityRef ?? principal ?? 'unknown');
              
              // Log credential information for debugging
              logger.info(
                'delete-catalog-entity: Checking permissions for user',
                {
                  principal: principalStr,
                  // Only log these in debug scenarios - they may contain sensitive info
                  ...(process.env.LOG_FULL_CREDENTIALS === 'true' && {
                    credentials: JSON.stringify(credentials, null, 2),
                  }),
                },
              );

              try {
                const decision = (
                  await permissions.authorize(
                    [{ permission: catalogMcpDeletePermission }],
                    { credentials },
                  )
                )[0];

                // Log the authorization decision
                logger.info(
                  'delete-catalog-entity: Permission authorization decision',
                  {
                    permission: catalogMcpDeletePermission.name,
                    result: decision.result,
                    principal: principalStr,
                  },
                );

                if (decision.result !== AuthorizeResult.ALLOW) {
                  logger.warn(
                    'delete-catalog-entity: Permission denied',
                    {
                      permission: catalogMcpDeletePermission.name,
                      result: decision.result,
                      principal: principalStr,
                    },
                  );
                  return {
                    output: {
                      success: false,
                      error:
                        'Permission denied: You do not have permission to delete catalog entities. This action requires membership in the "write" group.',
                    },
                  };
                }

                logger.info(
                  'delete-catalog-entity: Permission granted, proceeding with deletion',
                  {
                    principal: principalStr,
                  },
                );
              } catch (error) {
                const err = error as Error;
                logger.error(
                  'delete-catalog-entity: Permission check failed for delete action',
                  {
                    error: err.message,
                    stack: err.stack,
                    principal: principalStr,
                  },
                );
                return {
                  output: {
                    success: false,
                    error:
                      'Permission check failed. Ensure the permission framework is properly configured.',
                  },
                };
              }
            } else {
              logger.warn('delete-catalog-entity: No credentials provided for delete action');
              return {
                output: {
                  success: false,
                  error: 'Authentication required: No credentials provided',
                },
              };
            }

            try {
              const { entityRef } = input;

              logger.info(
                `delete-catalog-entity: Attempting to delete entity: ${entityRef}`,
              );

              // Create a catalog client to delete the entity
              const catalogClient = new CatalogClient({
                discoveryApi: discovery,
              });

              // Get plugin credentials for API calls
              const { token } = await auth.getPluginRequestToken({
                onBehalfOf: credentials,
                targetPluginId: 'catalog',
              });

              // Parse the entity reference (format: kind:namespace/name)
              // If only kind:name is provided, assume default namespace
              const refParts = entityRef.split(':');
              if (refParts.length !== 2) {
                throw new Error(
                  `Invalid entity reference format: ${entityRef}. Expected format: kind:namespace/name or kind:name`,
                );
              }

              const kind = refParts[0];
              const namePart = refParts[1];
              const [namespace, name] = namePart.includes('/')
                ? namePart.split('/')
                : ['default', namePart];

              logger.info(
                `delete-catalog-entity: Parsed entity - kind: ${kind}, namespace: ${namespace}, name: ${name}`,
              );

              // Look up the entity to get its UID
              const entity = await catalogClient.getEntityByRef(
                { kind, namespace, name },
                { token },
              );

              if (!entity) {
                logger.warn(
                  `delete-catalog-entity: Entity not found: ${entityRef}`,
                );
                return {
                  output: {
                    success: false,
                    error: `Entity not found: ${entityRef}`,
                  },
                };
              }

              const uid = entity.metadata.uid;
              if (!uid) {
                logger.error(
                  `delete-catalog-entity: Entity ${entityRef} has no UID`,
                );
                return {
                  output: {
                    success: false,
                    error: `Entity ${entityRef} has no UID - cannot delete`,
                  },
                };
              }

              logger.info(
                `delete-catalog-entity: Found entity UID: ${uid} for ${entityRef}`,
              );

              // For Location entities, use the location-specific deletion with location ID
              if (kind.toLowerCase() === 'location') {
                // For Location entities, get the Location object to obtain its ID
                const location = await catalogClient.getLocationByEntity(
                  { kind, namespace, name },
                  { token }
                );
                
                if (!location) {
                  logger.error(
                    `delete-catalog-entity: Location object not found for entity: ${entityRef}`,
                  );
                  return {
                    output: {
                      success: false,
                      error: `Location object not found for entity: ${entityRef}`,
                    },
                  };
                }
                
                logger.info(
                  `delete-catalog-entity: Deleting Location using removeLocationById with ID: ${location.id}`,
                );
                await catalogClient.removeLocationById(location.id, { token });
              } else {
                // Delete regular entities using their UID
                await catalogClient.removeEntityByUid(uid, { token });
              }

              logger.info(
                `delete-catalog-entity: Successfully deleted entity: ${entityRef} (UID: ${uid})`,
              );

              return {
                output: {
                  success: true,
                  message: `Successfully deleted entity: ${entityRef}`,
                },
              };
            } catch (error) {
              const err = error as Error;
              logger.error(
                'delete-catalog-entity: Error deleting catalog entity',
                {
                  error: err.message,
                  stack: err.stack,
                  entityRef: input.entityRef,
                },
              );
              return {
                output: {
                  success: false,
                  error: `Failed to delete entity: ${err.message}`,
                },
              };
            }
          },
        });
      },
    });
  },
});

// fetchCatalogEntities retrieves the list of entities present in the Backstage catalog, with optional filtering by kind and type
export async function fetchCatalogEntities(
  catalog: CatalogService,
  auth: any,
  logger: LoggerService,
  input?: {
    kind?: string;
    type?: string;
    name?: string;
    owner?: string;
    tags?: string;
    lifecycle?: string;
    verbose?: boolean;
  },
) {
  const credentials = await auth.getOwnServiceCredentials();

  // Build filter object based on input parameters
  const filter: any = {};
  if (input?.kind) {
    filter.kind = input.kind;
  }
  if (input?.type) {
    filter['spec.type'] = input.type;
  }
  if (input?.name) {
    filter['metadata.name'] = input.name;
  }
  if (input?.owner) {
    filter['spec.owner'] = input.owner;
  }
  if (input?.lifecycle) {
    filter['spec.lifecycle'] = input.lifecycle;
  }
  if (input?.tags) {
    filter['metadata.tags'] = input.tags.split(',').map(tag => tag.trim());
  }

  const getEntitiesOptions: any = {
    filter,
  };

  // When using the reduced output, we can also reduce the number of fields fetched via the API
  if (!input?.verbose) {
    getEntitiesOptions.fields = [
      'metadata.name',
      'kind',
      'metadata.tags',
      'metadata.description',
      'spec.type',
      'spec.owner',
      'spec.lifecycle',
      'relations',
    ];
  }

  // Avoid potentially logging PII when we log which filters are being used
  const logEntityNames = process.env.LOG_ENTITY_NAMES === 'true';
  const loggedFilters = {
    ...getEntitiesOptions.filter,
  };
  if (!logEntityNames) {
    if (Object.prototype.hasOwnProperty.call(loggedFilters, 'metadata.name')) {
      loggedFilters['metadata.name'] = '[REDACTED]';
    }
    if (Object.prototype.hasOwnProperty.call(loggedFilters, 'spec.owner')) {
      loggedFilters['spec.owner'] = '[REDACTED]';
    }
  }
  // Log the options being used to fetch the entities, with PII redacted
  logger.info(
    'fetch-catalog-entities: Fetching catalog entities with options:',
    loggedFilters,
  );

  const { items } = await catalog.getEntities(getEntitiesOptions, {
    credentials,
  });

  return {
    // Return full Entity objects when fullOutput is true
    entities: input?.verbose
      ? items
      : items.map(entity => ({
          name: entity.metadata.name,
          kind: entity.kind,
          tags: entity.metadata.tags?.join(',') || '',
          description: entity.metadata.description,
          lifecycle:
            typeof entity.spec?.lifecycle === 'string'
              ? entity.spec.lifecycle
              : undefined,
          type:
            typeof entity.spec?.type === 'string'
              ? entity.spec.type
              : undefined,
          owner:
            typeof entity.spec?.owner === 'string'
              ? entity.spec.owner
              : undefined,
          dependsOn:
            entity.relations
              ?.filter(relation => relation.type === 'dependsOn')
              .map(relation => relation.targetRef)
              .join(',') || '',
        })),
  };
}
