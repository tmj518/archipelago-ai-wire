#!/usr/bin/env node
/**
 * Register the daily unattended run as a Windows scheduled task.
 *
 * Uses schtasks.exe from Node rather than a PowerShell script: three PowerShell
 * attempts were rejected by the parser before running a single command, on quoting
 * and line-ending handling, and this is not the thing worth spending the round on.
 * Node's argument passing has no such ambiguity.
 *
 *   node tools/register-daily-task.mjs            # register at 08:10
 *   node tools/register-daily-task.mjs --at 08:10
 *   node tools/register-daily-task.mjs --remove
 *   node tools/register-daily-task.mjs --status
 *
 * What the flags mean, and why each is set:
 *   WakeToRun          the machine wakes from sleep, so a closed lid does not skip it
 *   StartWhenAvailable a run missed while the machine was off starts when it can
 *   ExecutionLimit 6h  a backstop against a hung run, not a target
 *   IgnoreNew          a still-running session is not stacked on
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const REPO = "C:\\Users\\tmj19\\Desktop\\出海官网更新工作流";
const TASK = "LandedMath-Daily";
const WRAPPER = join(REPO, "tools", "run-daily.ps1");

const argv = process.argv.slice(2);
const getArg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const AT = getArg("--at", "08:10");
const SD = getArg("--sd", new Date().toISOString().slice(0, 10));
const RUNAS = getArg("--ru", `${process.env.USERDOMAIN}\\${process.env.USERNAME}`);
const REMOVE = argv.includes("--remove");
const STATUS = argv.includes("--status");

const schtasks = (args, quiet = false) => {
  const r = spawnSync("schtasks.exe", args, { encoding: "utf8", windowsHide: true });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (!quiet && out) console.log(out.split("\n").map((l) => "    " + l).join("\n"));
  return { code: r.status, out };
};

/* ------------------------------------------------------------------- status */
if (STATUS || REMOVE) {
  console.log(`task: ${TASK}\n` + "=".repeat(70));
  const q = spawnSync("schtasks.exe", ["/Query", "/TN", TASK, "/V", "/FO", "LIST"], { encoding: "utf8", windowsHide: true });
  if (q.status !== 0) {
    console.log("  not registered");
    process.exit(REMOVE ? 0 : 1);
  }
  for (const line of q.stdout.split("\n")) {
    if (/TaskName|Next Run Time|Last Run Time|Last Result|Status|Schedule Type|Start Time|Task To Run|Run As User/i.test(line)) {
      console.log("  " + line.trim());
    }
  }
  if (REMOVE) {
    console.log("\nremoving...");
    schtasks(["/Delete", "/TN", TASK, "/F"]);
    console.log("  removed");
  }
  process.exit(0);
}

/* ----------------------------------------------------------------- register */
if (!existsSync(WRAPPER)) {
  console.log(`ABORT: wrapper not found at ${WRAPPER}`);
  process.exit(1);
}

// Replace any existing task so this is idempotent.
spawnSync("schtasks.exe", ["/Delete", "/TN", TASK, "/F"], { windowsHide: true });

console.log(`registering ${TASK} daily at ${AT}`);
console.log(`  wrapper: ${WRAPPER}`);
console.log(`  workdir: ${REPO}\n`);

/*
 * Arguments matched field-for-field against the two PolicyBriefEN tasks that run
 * successfully on this machine:
 *
 *   Command          full path to Windows PowerShell, not "powershell.exe". The
 *                    working task uses the explicit path; relying on PATH was one
 *                    difference in the version that did not work.
 *   WorkingDirectory set explicitly. The broken registration left it empty, so
 *                    anything relative resolved against System32.
 *   LogonType        InteractiveToken, same as the working tasks.
 *   /RL omitted      the working tasks carry no RunLevel, and adding HIGHEST here
 *                    made schtasks refuse with access denied.
 */
const create = [
  "/Create",
  "/TN", TASK,
  "/TR", `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "${WRAPPER}"`,
  "/SC", "DAILY",
  "/ST", AT,
  "/SD", SD,
  "/RU", RUNAS,
  "/F",
];
const r = schtasks(create, true);
console.log(`  create exit: ${r.code}${r.out ? "  " + r.out.split("\n")[0] : ""}`);
if (r.code !== 0) {
  console.log("");
  console.log("  Registering a scheduled task needs administrator rights on this machine.");
  console.log("  Two ways forward:");
  console.log("");
  console.log("  A. Run this once from an elevated terminal (right-click PowerShell -> Run as administrator):");
  console.log(`       node "${join(REPO, "tools", "register-daily-task.mjs")}" --at ${AT}`);
  console.log("");
  console.log("  B. Or import the XML this script writes:");
  console.log(`       schtasks /Create /TN ${TASK} /XML "${join(REPO, "tools", TASK + ".xml")}" /F`);
  process.exit(1);
}

/*
 * schtasks cannot set WakeToRun or StartWhenAvailable directly, so apply them
 * through the Task Scheduler's own PowerShell module afterwards. Kept separate
 * deliberately: if that step fails the task still exists and still runs on a
 * machine that is awake, which is the common case.
 */
const tweak = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    [
      "$s = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew;",
      `Set-ScheduledTask -TaskName '${TASK}' -Settings $s | Out-Null;`,
      "Write-Output 'settings applied'",
    ].join(" "),
  ],
  { encoding: "utf8", windowsHide: true },
);
console.log(`  settings exit: ${tweak.status}  ${(tweak.stdout ?? "").trim()}${(tweak.stderr ?? "").trim()}`);

/* ------------------------------------------------------------------ confirm */
console.log("");
const q = spawnSync("schtasks.exe", ["/Query", "/TN", TASK, "/V", "/FO", "LIST"], { encoding: "utf8", windowsHide: true });
for (const line of q.stdout.split("\n")) {
  if (/TaskName|Next Run Time|Last Result|Status|Start Time|Task To Run|Run As User|Repeat/i.test(line)) {
    console.log("  " + line.trim());
  }
}
console.log(`\nrun it once now to test:  schtasks /Run /TN ${TASK}`);
console.log(`watch the log:            Get-Content "${join(REPO, "logs")}\\daily-*.log" -Tail 40 -Wait`);
