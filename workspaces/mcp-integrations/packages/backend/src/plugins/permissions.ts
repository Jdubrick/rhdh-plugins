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
import { createBackendModule } from '@backstage/backend-plugin-api';
import { BackstageIdentityResponse } from '@backstage/plugin-auth-node';
import {
  AuthorizeResult,
  isPermission,
  PolicyDecision,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
} from '@backstage/plugin-permission-node';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';

import {
  catalogMcpFetchPermission,
  catalogMcpDeletePermission,
} from '@red-hat-developer-hub/backstage-plugin-software-catalog-mcp-tool';

/**
 * Permission policy for the software-catalog-mcp-tool plugin
 *
 * This policy implements:
 * - Users in 'backstage-read' or 'backstage-write' groups can fetch catalog entities
 * - Only users in the 'backstage-write' group can delete catalog entities
 * 
 * Note: This custom policy is currently DISABLED in favor of RBAC (see index.ts)
 * The unified groups backstage-read and backstage-write aggregate permissions
 * from multiple providers (Keycloak, GitHub, etc.)
 */
class CatalogMcpPermissionPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: BackstageIdentityResponse,
  ): Promise<PolicyDecision> {
    // Allow fetch permission for authenticated users in 'backstage-read' or 'backstage-write' groups
    if (isPermission(request.permission, catalogMcpFetchPermission)) {
      if (!user) {
        return { result: AuthorizeResult.DENY };
      }

      // Check if user is in the unified backstage-read or backstage-write group
      const userGroups = user.identity.ownershipEntityRefs || [];
      const isInReadOrWriteGroup = userGroups.some(
        ref =>
          ref === 'group:default/backstage-read' ||
          ref === 'group:default/backstage-write' ||
          ref.endsWith('/backstage-read') ||
          ref.endsWith('/backstage-write'),
      );

      return {
        result: isInReadOrWriteGroup
          ? AuthorizeResult.ALLOW
          : AuthorizeResult.DENY,
      };
    }

    // Allow delete permission only for users in the 'backstage-write' group
    if (isPermission(request.permission, catalogMcpDeletePermission)) {
      if (!user) {
        return { result: AuthorizeResult.DENY };
      }

      // Check if user is in the unified backstage-write group
      const userGroups = user.identity.ownershipEntityRefs || [];
      const isInWriteGroup = userGroups.some(
        ref => ref === 'group:default/backstage-write' || ref.endsWith('/backstage-write'),
      );

      return {
        result: isInWriteGroup ? AuthorizeResult.ALLOW : AuthorizeResult.DENY,
      };
    }

    // Default: allow other permissions
    return { result: AuthorizeResult.ALLOW };
  }
}

/**
 * Permission policy backend module
 */
export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'catalog-mcp-policy',
  register(reg) {
    reg.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new CatalogMcpPermissionPolicy());
      },
    });
  },
});

