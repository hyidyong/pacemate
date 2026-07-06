import { getRoadmapRevisionRequests } from "@/services/roadmap-revisions.service";

export async function getAdminApprovalData() {
  const requests = await getRoadmapRevisionRequests();

  return {
    pending: requests.filter((request) => request.status === "pending"),
    reviewed: requests.filter((request) => request.status === "assistant_reviewed"),
    completed: requests.filter(
      (request) => request.status === "approved" || request.status === "rejected",
    ),
  };
}
