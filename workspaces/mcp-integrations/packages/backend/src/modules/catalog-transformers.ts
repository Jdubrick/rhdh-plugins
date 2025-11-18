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
import {
  GroupTransformer as KeycloakGroupTransformer,
  UserTransformer,
  keycloakTransformerExtensionPoint,
} from '@backstage-community/plugin-catalog-backend-module-keycloak';
import {
  githubOrgEntityProviderTransformsExtensionPoint,
} from '@backstage/plugin-catalog-backend-module-github-org';
import {
  TeamTransformer,
  UserTransformer as GitHubUserTransformer,
  defaultOrganizationTeamTransformer,
  defaultUserTransformer as defaultGitHubUserTransformer,
} from '@backstage/plugin-catalog-backend-module-github';

const KEYCLOAK_WRITE_GROUPS = ['admins', 'admin', 'write'];
const KEYCLOAK_READ_GROUPS = ['read'];
const GITHUB_WRITE_TEAM_SLUGS = ['developers', 'developer'];
const GITHUB_USER_TEAMS_QUERY = `
  query userTeamSlugs($org: String!, $userLogins: [String!]!, $cursor: String) {
    organization(login: $org) {
      teams(first: 100, after: $cursor, userLogins: $userLogins) {
        nodes {
          slug
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;
const MAX_GITHUB_TEAM_PAGES = 20;

const normalize = (value?: string) => value?.toLowerCase();
const trimLeadingSlash = (value?: string) => value?.replace(/^\/+/, '');

const isKeycloakWriteGroup = (groupName?: string) =>
  !!groupName && KEYCLOAK_WRITE_GROUPS.includes(normalize(groupName) ?? '');

const isKeycloakReadGroup = (groupName?: string) =>
  !!groupName && KEYCLOAK_READ_GROUPS.includes(normalize(groupName) ?? '');

const isGithubWriteTeam = (teamSlug?: string) =>
  !!teamSlug &&
  GITHUB_WRITE_TEAM_SLUGS.some(slug =>
    (normalize(teamSlug) ?? '').includes(slug),
  );

const fetchGithubUserTeamSlugs = async (
  userLogin: string | undefined,
  ctx: { client?: any; org?: string },
): Promise<string[]> => {
  if (!userLogin || !ctx?.client || !ctx?.org) {
    return [];
  }

  const slugs = new Set<string>();
  let cursor: string | undefined;
  for (let i = 0; i < MAX_GITHUB_TEAM_PAGES; i++) {
    const response = await ctx.client(GITHUB_USER_TEAMS_QUERY, {
      org: ctx.org,
      userLogins: [userLogin],
      cursor,
    });

    const teams = response?.organization?.teams;
    if (!teams) {
      break;
    }

    teams.nodes?.forEach((node: { slug?: string }) => {
      if (node?.slug) {
        slugs.add(normalize(node.slug) ?? node.slug);
      }
    });

    if (!teams.pageInfo?.hasNextPage || !teams.pageInfo?.endCursor) {
      break;
    }

    cursor = teams.pageInfo.endCursor;
  }

  return Array.from(slugs);
};

const extractKeycloakGroupName = (group: any): string | undefined => {
  if (!group) {
    return undefined;
  }

  if (typeof group === 'string') {
    return normalize(trimLeadingSlash(group));
  }

  if (typeof group === 'object') {
    const candidates = [
      group.name,
      group.path?.split('/').filter(Boolean).pop(),
      group.id,
    ];
    const first = candidates.find(Boolean);
    return normalize(first);
  }

  return undefined;
};

const getKeycloakUserGroupNames = (
  userGroups?: any[],
  fallbackGroups?: string[],
): string[] => {
  if (Array.isArray(userGroups) && userGroups.length > 0) {
    return userGroups
      .map(extractKeycloakGroupName)
      .filter((value): value is string => Boolean(value));
  }

  if (Array.isArray(fallbackGroups)) {
    return fallbackGroups
      .map(group =>
        typeof group === 'string'
          ? normalize(group.split('/').filter(Boolean).pop())
          : undefined,
      )
      .filter((value): value is string => Boolean(value));
  }

  return [];
};

/**
 * Custom group transformer for Keycloak groups.
 * Maps Keycloak groups to unified Backstage groups based on permission levels.
 * 
 * Mapping strategy:
 * - admins, write -> members of backstage-write
 * - read -> members of backstage-read
 */
const customKeycloakGroupTransformer: KeycloakGroupTransformer = async (
  entity,
  _realm,
  _groups,
) => {
  const groupName = normalize(entity.metadata.name);
  
  // Map provider-specific groups to unified parent groups
  if (isKeycloakWriteGroup(groupName)) {
    // These groups should be children of backstage-write
    entity.spec.parent = 'backstage-write';
  } else if (isKeycloakReadGroup(groupName)) {
    // This group should be a child of backstage-read
    entity.spec.parent = 'backstage-read';
  }
  
  return entity;
};

/**
 * Custom user transformer for Keycloak users.
 * Adds users to unified Backstage groups based on their Keycloak group membership.
 * 
 * Mapping strategy:
 * - If user is in 'admins' or 'write' -> add to 'backstage-write'
 * - If user is in 'read' -> add to 'backstage-read'
 */
const customKeycloakUserTransformer: UserTransformer = async (
  entity,
  user,
  _realm,
  _groups,
) => {
  try {
    // Ensure memberOf array exists
    if (!entity.spec.memberOf) {
      entity.spec.memberOf = [];
    }
    
    // Determine which unified groups the user should be in based on their Keycloak groups
    const userGroupNames = getKeycloakUserGroupNames(
      user.groups,
      entity.spec.memberOf,
    );
    const hasWriteAccess = userGroupNames.some(isKeycloakWriteGroup);
    const hasReadAccess = userGroupNames.some(isKeycloakReadGroup);
    
    // Add unified group memberships using proper entity references
    const backstageWriteRef = 'group:default/backstage-write';
    const backstageReadRef = 'group:default/backstage-read';
    
    if (hasWriteAccess && !entity.spec.memberOf.includes(backstageWriteRef)) {
      entity.spec.memberOf.push(backstageWriteRef);
    }
    
    if (hasReadAccess && !entity.spec.memberOf.includes(backstageReadRef)) {
      entity.spec.memberOf.push(backstageReadRef);
    }
  } catch (error) {
    // Log error but don't break user ingestion
    console.error('Error in Keycloak user transformer:', error);
  }
  
  return entity;
};

/**
 * Custom user transformer for GitHub users.
 * Adds users to unified Backstage groups based on their GitHub team membership.
 * 
 * Mapping strategy:
 * - If user is in 'developers' team -> add to 'backstage-write'
 */
const customGitHubUserTransformer: GitHubUserTransformer = async (user, ctx) => {
  // Use the default transformer to create the base entity
  const entity = await defaultGitHubUserTransformer(user, ctx);
  
  if (!entity) {
    return undefined;
  }
  
  try {
    // Ensure memberOf array exists
    if (!entity.spec.memberOf) {
      entity.spec.memberOf = [];
    }
    
    // Fetch the user's GitHub teams and map to unified groups
    const teamSlugs = await fetchGithubUserTeamSlugs(user.login, ctx);
    const hasWriteAccess = teamSlugs.some(slug => isGithubWriteTeam(slug));
    
    // Add unified group memberships using proper entity references
    const backstageWriteRef = 'group:default/backstage-write';
    
    if (hasWriteAccess && !entity.spec.memberOf.includes(backstageWriteRef)) {
      entity.spec.memberOf.push(backstageWriteRef);
    }
  } catch (error) {
    // Log error but don't break user ingestion
    console.error('Error in GitHub user transformer:', error);
  }
  
  return entity;
};

/**
 * Custom team transformer for GitHub teams.
 * Maps GitHub teams to unified Backstage groups based on permission levels.
 * 
 * Mapping strategy:
 * - developers -> members of backstage-write
 * 
 * Note: This transformer receives raw GitHub team data and must create the entity.
 * It uses the default transformer first, then modifies the parent relationship.
 */
const customGithubTeamTransformer: TeamTransformer = async (team, ctx) => {
  return defaultOrganizationTeamTransformer(team, ctx);
};

/**
 * Backend module that registers custom transformers for catalog providers.
 * This module must have pluginId set to 'catalog' to match the catalog providers.
 */
export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'unified-group-transformers',
  register(reg) {
    // Register both Keycloak and GitHub transformers in a single registerInit
    reg.registerInit({
      deps: {
        keycloak: keycloakTransformerExtensionPoint,
        github: githubOrgEntityProviderTransformsExtensionPoint,
      },
      async init({ keycloak, github }) {
        // Set Keycloak transformers
        keycloak.setUserTransformer(customKeycloakUserTransformer);
        keycloak.setGroupTransformer(customKeycloakGroupTransformer);
        
        // Set GitHub org transformers
        github.setUserTransformer(customGitHubUserTransformer);
        github.setTeamTransformer(customGithubTeamTransformer);
      },
    });
  },
});

