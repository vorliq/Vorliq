const request = require("supertest");
const fs = require("fs");

const app = require("../index");

describe("GET /api/backup/status", () => {
  const originalBackupDir = process.env.VORLIQ_BACKUP_DIR;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalBackupDir === undefined) {
      delete process.env.VORLIQ_BACKUP_DIR;
    } else {
      process.env.VORLIQ_BACKUP_DIR = originalBackupDir;
    }
  });

  test("returns safe metadata for the newest backup", async () => {
    process.env.VORLIQ_BACKUP_DIR = "/secret/server/path/backups";
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "readdirSync").mockReturnValue([
      "vorliq-backup-2026-05-14-021500.tar.gz",
      "vorliq-backup-2026-05-15-021500.tar.gz",
      ".env",
      "notes.txt",
    ]);
    jest.spyOn(fs, "statSync").mockImplementation((filePath) => {
      const isNewest = String(filePath).includes("2026-05-15");
      return {
        size: isNewest ? 1048576 : 2048,
        mtime: new Date(isNewest ? "2026-05-15T02:15:00.000Z" : "2026-05-14T02:15:00.000Z"),
        mtimeMs: isNewest ? 2000 : 1000,
      };
    });

    const response = await request(app).get("/api/backup/status");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.backup_directory_exists).toBe(true);
    expect(response.body.latest_backup.file_name).toBe("vorliq-backup-2026-05-15-021500.tar.gz");
    expect(response.body.latest_backup.size_bytes).toBe(1048576);
    expect(response.body.latest_backup.size_mb).toBe(1);
    expect(JSON.stringify(response.body)).not.toContain("/secret/server/path");
    expect(JSON.stringify(response.body)).not.toContain(".env");
    expect(JSON.stringify(response.body)).not.toContain("contents");
  });

  test("returns a warning-friendly empty status when no backup directory exists", async () => {
    process.env.VORLIQ_BACKUP_DIR = "/missing/backups";
    jest.spyOn(fs, "existsSync").mockReturnValue(false);

    const response = await request(app).get("/api/backup/status");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.backup_directory_exists).toBe(false);
    expect(response.body.latest_backup).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain("/missing/backups");
  });
});
