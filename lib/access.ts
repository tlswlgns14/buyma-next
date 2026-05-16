export const DEFAULT_ACCESS_DAYS = 7;

export function isAccessExpired(accessExpiresAt: string | null | undefined) {
  if (!accessExpiresAt) {
    return false;
  }

  return new Date(accessExpiresAt).getTime() <= Date.now();
}

export function formatAccessDate(accessExpiresAt: string | null | undefined) {
  if (!accessExpiresAt) {
    return "";
  }

  const date = new Date(accessExpiresAt);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
