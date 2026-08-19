import { describe, expect, it, vi } from "vitest";

import {
  grantAttentionViewer,
  type ViewerGrantDependencies,
  type ViewerGrantUser,
} from "@/lib/attention-runtime/viewerGrant";

function harness(options: { invitationError?: Error } = {}) {
  const users = new Map<string, ViewerGrantUser>();
  const memberships = new Map<string, { role: "viewer"; grantedBy: string }>();
  let nextUserId = 1;
  const sendInvitation = vi.fn(async () => {
    if (options.invitationError) throw options.invitationError;
  });
  const dependencies: ViewerGrantDependencies = {
    findUserByEmail: async (email) => users.get(email) ?? null,
    createUserWithoutEmail: async (email) => {
      const user = { id: `user-${nextUserId++}`, email };
      users.set(email, user);
      return user;
    },
    upsertMembership: async ({ engineInstanceId, userId, role, grantedBy }) => {
      memberships.set(`${engineInstanceId}:${userId}`, { role, grantedBy });
    },
    sendInvitation,
  };
  return { users, memberships, sendInvitation, dependencies };
}

const input = {
  email: "viewer@example.com",
  engineInstanceId: "attention-engine",
  ownerId: "owner-id",
  redirectTo: "https://example.com/auth/callback?redirectTo=%2Fattention",
};

describe("attention viewer grants", () => {
  it("creates membership without sending anything under --no-invite semantics", async () => {
    const test = harness();
    const result = await grantAttentionViewer({ ...input, noInvite: true }, test.dependencies);

    expect(result).toMatchObject({
      userId: "user-1",
      role: "viewer",
      userCreated: true,
      invitationSent: false,
      invitationReason: "not_requested",
    });
    expect(test.memberships.get("attention-engine:user-1")).toEqual({ role: "viewer", grantedBy: "owner-id" });
    expect(test.sendInvitation).not.toHaveBeenCalled();
  });

  it("retains usable membership when invitation delivery fails", async () => {
    const test = harness({ invitationError: new Error("email rate limit exceeded") });
    const result = await grantAttentionViewer({ ...input, noInvite: false }, test.dependencies);

    expect(result).toMatchObject({
      userId: "user-1",
      role: "viewer",
      invitationSent: false,
      invitationReason: "email rate limit exceeded",
    });
    expect(test.memberships.has("attention-engine:user-1")).toBe(true);
    expect(test.users.get(input.email)?.id).toBe("user-1");
  });

  it("is idempotent when the same email is granted repeatedly", async () => {
    const test = harness();
    const first = await grantAttentionViewer({ ...input, noInvite: true }, test.dependencies);
    const second = await grantAttentionViewer({ ...input, noInvite: true }, test.dependencies);

    expect(second.userId).toBe(first.userId);
    expect(second.userCreated).toBe(false);
    expect(test.users).toHaveLength(1);
    expect(test.memberships).toHaveLength(1);
    expect(test.memberships.get(`attention-engine:${first.userId}`)).toEqual({ role: "viewer", grantedBy: "owner-id" });
  });
});
