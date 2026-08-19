export interface ViewerGrantUser {
  id: string;
  email?: string | null;
}

export interface ViewerGrantDependencies {
  findUserByEmail(email: string): Promise<ViewerGrantUser | null>;
  createUserWithoutEmail(email: string): Promise<ViewerGrantUser>;
  upsertMembership(input: {
    engineInstanceId: string;
    userId: string;
    role: "viewer";
    grantedBy: string;
  }): Promise<void>;
  sendInvitation(email: string, redirectTo: string): Promise<void>;
}

export interface GrantViewerInput {
  email: string;
  engineInstanceId: string;
  ownerId: string;
  redirectTo: string;
  noInvite: boolean;
}

export interface GrantViewerResult {
  operation: "grant";
  email: string;
  userId: string;
  engineInstanceId: string;
  role: "viewer";
  userCreated: boolean;
  invitationSent: boolean;
  invitationReason?: string;
  redirectTo: "/attention";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Provisioning order is deliberate: auth identity, durable membership, optional email.
 * Email delivery is best-effort and can never roll back or prevent a successful grant.
 */
export async function grantAttentionViewer(
  input: GrantViewerInput,
  dependencies: ViewerGrantDependencies,
): Promise<GrantViewerResult> {
  let user = await dependencies.findUserByEmail(input.email);
  const userCreated = !user;
  if (!user) user = await dependencies.createUserWithoutEmail(input.email);

  if (user.id === input.ownerId) {
    throw new Error("The canonical owner cannot be granted as a viewer.");
  }

  await dependencies.upsertMembership({
    engineInstanceId: input.engineInstanceId,
    userId: user.id,
    role: "viewer",
    grantedBy: input.ownerId,
  });

  if (input.noInvite) {
    return {
      operation: "grant",
      email: input.email,
      userId: user.id,
      engineInstanceId: input.engineInstanceId,
      role: "viewer",
      userCreated,
      invitationSent: false,
      invitationReason: "not_requested",
      redirectTo: "/attention",
    };
  }

  try {
    await dependencies.sendInvitation(input.email, input.redirectTo);
    return {
      operation: "grant",
      email: input.email,
      userId: user.id,
      engineInstanceId: input.engineInstanceId,
      role: "viewer",
      userCreated,
      invitationSent: true,
      redirectTo: "/attention",
    };
  } catch (error) {
    return {
      operation: "grant",
      email: input.email,
      userId: user.id,
      engineInstanceId: input.engineInstanceId,
      role: "viewer",
      userCreated,
      invitationSent: false,
      invitationReason: errorMessage(error),

      redirectTo: "/attention",
    };
  }
}
