window.__ModuleLoader__.load({
  id: 'dsh-project-workbench',
  factory(require) {
var __projectWorkbenchModule = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // client-src/index.js
  var index_exports = {};
  __export(index_exports, {
    default: () => index_default
  });
  var import_react22 = __toESM(__require("react"), 1);

  // client-src/shell/main-shell.js
  var import_react19 = __toESM(__require("react"), 1);

  // core/state.js
  var TERMINAL_ISSUE = /* @__PURE__ */ new Set(["done", "cancelled"]);
  var blank = (v) => v === void 0 || v === null || String(v).trim() === "";
  function requirementOverview({ q_pain, goal }) {
    return String(q_pain ?? "").trim() || String(goal ?? "").trim();
  }
  var TASK_CONTENT_FIELDS = ["title", "problemOverview", "acceptance", "triggerPath", "rootCause", "description", "refs"];
  function taskOverview({ problemOverview, description }) {
    return typeof problemOverview === "string" && problemOverview.trim() || typeof description === "string" && description.trim() || "";
  }
  function taskContentBlockers(issue) {
    const missing = [];
    if (typeof issue.title !== "string" || blank(issue.title)) missing.push("title");
    if (!taskOverview(issue)) missing.push("problemOverview");
    return missing;
  }
  function changesReviewedRequirement(current, patch) {
    return requirementOverview(current) !== requirementOverview({ ...current, ...patch }) || ["goal", "scope", "q_out", "acceptance", "q_success"].some((key) => Object.hasOwn(patch, key) && String(patch[key] ?? "") !== String(current[key] ?? ""));
  }
  function startBlockers(issue) {
    const missing = taskContentBlockers(issue);
    if (blank(issue.acceptance)) missing.push("acceptance");
    return missing;
  }

  // client-src/api.js
  async function rpc(method, input) {
    try {
      const res = await fetch("/api/project-workbench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, input })
      });
      const body = await res.json();
      return body?.ok === false && typeof body === "object" ? { ...body, method } : body;
    } catch (error) {
      return { ok: false, code: "TRANSPORT_ERROR", message: error instanceof Error ? error.message : String(error), method };
    }
  }

  // client-src/project-state.js
  var projectIdOf = (w) => String(w?.workspaceId ?? "").startsWith("folder:") ? null : w?.workspaceId ?? null;
  var reqDraftKey = (projectKey, reqId) => `${projectKey}|req|${reqId}`;
  var issueDraftKey = (projectKey, reqId, issueId) => `${projectKey}|issue|${reqId}|${issueId}`;
  var reqDraftFrom = (req) => ({
    title: req.title ?? "",
    q_who: req.q_who ?? "",
    q_pain: requirementOverview(req),
    q_success: req.q_success ?? "",
    q_out: req.q_out ?? "",
    goal: req.goal ?? "",
    scope: req.scope ?? "",
    acceptance: req.acceptance ?? ""
  });
  var issueDraftFrom = (issue = {}) => ({
    title: issue.title ?? "",
    problemOverview: taskOverview(issue),
    acceptance: issue.acceptance ?? "",
    triggerPath: issue.triggerPath ?? "",
    rootCause: issue.rootCause ?? "",
    description: issue.description?.trim() !== taskOverview(issue) ? issue.description ?? "" : "",
    refs: Array.isArray(issue.refs) ? issue.refs.join("\n") : ""
  });
  function taskFormError(draft) {
    const missing = taskContentBlockers({ title: draft.title, problemOverview: draft.problemOverview });
    if (missing.length) return { ok: false, code: "MISSING_TASK_FIELDS", message: `task needs: ${missing.join(", ")}` };
    return null;
  }
  function taskContentPatch(draft, issue) {
    const saved = issueDraftFrom(issue);
    const patch = {};
    for (const key of TASK_CONTENT_FIELDS) {
      const value = String(draft[key] ?? saved[key]).trim();
      if (value !== saved[key].trim()) patch[key] = key === "refs" ? value.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean) : value;
    }
    if (Object.hasOwn(patch, "description") && !issue?.problemOverview?.trim()) {
      patch.problemOverview = String(draft.problemOverview ?? saved.problemOverview).trim();
    }
    return patch;
  }
  function newTaskInput(draft) {
    const { title, ...fields } = taskContentPatch(draft);
    return { title, fields };
  }
  var sameDraft = (a, b) => {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => (a[k] ?? "") === (b[k] ?? ""));
  };
  var draftOf = (drafts, key, fallback) => ({ ...fallback, ...drafts[key]?.fields ?? {} });
  function classifyProject(data) {
    const diags = data?.diagnostics ?? [];
    const broken = diags.some((d) => ["WORKSPACE_MISSING", "READ_FAILED", "MISSING_FRONTMATTER"].includes(d.code));
    const notInitialized = !!data && !data.project && diags.some((d) => d.code === "NOT_INITIALIZED") && !broken;
    return { diags, notInitialized, readFailed: !!data && !data.project && !notInitialized };
  }
  var freshRead = (currentRoot, requestedRoot, currentSeq, seq) => currentRoot === requestedRoot && currentSeq === seq;
  async function deliveryFingerprint(req) {
    const tasks = (req.issues ?? []).map((i) => [i.id, i.hash]).sort((a, b) => a[0] < b[0] ? -1 : 1);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([req.hash, tasks])));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
  }
  function createCardActions({ getKey, rpc: rpc2, setBusy, setMsg, reload, failText, formatError = (res) => `${failText}: ${res.message}` }) {
    let busyKey = null;
    return async function act(method, input, onOk) {
      const requested = getKey();
      if (busyKey === requested) return void 0;
      busyKey = requested;
      setBusy(true);
      setMsg("");
      const res = await rpc2(method, input);
      if (getKey() !== requested) {
        if (busyKey === requested) busyKey = null;
        return res;
      }
      busyKey = null;
      setMsg(res.ok ? "" : formatError(res));
      setBusy(false);
      if (res.ok) onOk?.();
      reload();
      return res;
    };
  }

  // client-src/workbench-content.js
  var textOf = (value) => typeof value === "string" ? value.trim() : "";
  function taskResult(issue, since = issue?.deliveryStartedAt) {
    const roundStart = Math.max(Number(since) || 0, Number(issue?.deliveryStartedAt) || 0, Number(issue?.requirementDeliveryStartedAt) || 0);
    const fullSummary = textOf(issue?.resultSummary) || textOf(issue?.result?.split(/^###[ \t]+(?:摘要|客观记录|已知限制)/m)[0]);
    const fullLimits = textOf(issue?.knownLimits);
    const summaryParts = fullSummary.split(/\r?\n\r?\n\[AI 补充\] /).filter((part) => part.trim());
    const resultAt = Number(issue?.resultAt) || 0;
    const limitsAt = Number(issue?.knownLimitsAt) || 0;
    const evidenceAt = Math.max(Number(issue?.evidenceAt) || 0, Number(issue?.objectiveAt) || 0);
    const previousRound = roundStart > 0 && resultAt < roundStart;
    const staleResult = previousRound || issue?.resultFresh === false || roundStart > 0 && resultAt < evidenceAt;
    const current = !staleResult && (!roundStart || evidenceAt >= roundStart);
    const scoped = issue?.resultScopeAt != null && Number(issue.resultScopeAt) === roundStart;
    const recordedSummary = previousRound ? "" : scoped ? fullSummary : summaryParts.at(-1)?.trim() ?? "";
    const hasSupplement = !scoped && recordedSummary && summaryParts.length > 1;
    const latestSupplement = current && hasSupplement ? recordedSummary : "";
    const earlierSummary = hasSupplement ? fullSummary.slice(0, fullSummary.lastIndexOf(recordedSummary)).replace(/\r?\n\r?\n\[AI 补充\] $/, "") : "";
    const unknown = { status: "unverified", passed: 0, failed: 0, incomplete: 0, unconfirmedChanges: 0, hasManualEvidence: false };
    const taskVerification = roundStart <= Math.max(Number(issue?.deliveryStartedAt) || 0, Number(issue?.requirementDeliveryStartedAt) || 0) ? issue?.verification : null;
    return {
      summary: current ? recordedSummary.replace(/\r?\n\r?\n\[AI 补充\] /g, "\n\n") : "",
      recordedSummary,
      latestSupplement,
      earlierSummary,
      unverifiedResultContext: staleResult ? fullSummary : earlierSummary,
      previousSummary: staleResult ? fullSummary : "",
      fullSummary,
      limits: limitsAt > 0 && limitsAt >= roundStart ? fullLimits.replace(/\r?\n\r?\n\[AI 补充\] /g, "\n\n") : "",
      unverifiedLimits: limitsAt > 0 && limitsAt >= roundStart ? "" : fullLimits,
      fullLimits,
      verification: taskVerification ?? unknown
    };
  }
  function requirementResult(req) {
    const summary = textOf(req?.deliverySummary);
    const cancelImpact = textOf(req?.cancelImpact);
    const since = Number(req?.deliveryStartedAt) || 0;
    const summaryCurrent = (Number(req?.deliverySummaryAt) || 0) >= since;
    const impactCurrent = (Number(req?.cancelImpactAt) || 0) >= since;
    const hasCancelled = req?.issues?.some((issue) => issue.status === "cancelled") ?? req?.hasCancelled;
    return {
      summary: summaryCurrent ? summary : "",
      previousSummary: summaryCurrent ? "" : summary,
      cancelImpact: hasCancelled && impactCurrent ? cancelImpact : "",
      previousCancelImpact: hasCancelled && impactCurrent ? "" : cancelImpact
    };
  }
  var workbenchContentLocale = {
    en: {
      splitReview: "Task review",
      splitDetails: "Review details",
      splitVerified: "Verified",
      splitAssigned: "Existing task",
      splitGap: "Gap",
      splitUnknown: "Needs checking",
      splitWorking: "Checking existing tasks and project progress\u2026",
      splitNoNew: "No new tasks are needed.",
      splitNoDrafts: "There are no new tasks ready to adopt.",
      splitRethink: "Add a note and revise",
      splitFeedback: "What should the AI reconsider?",
      splitFeedbackHint: "For example, keep these two checks in the same task.",
      splitRetry: "Review again",
      splitAdopt: "Adopt and create task",
      splitNowAssigned: "This gap is assigned to the new task.",
      splitCheckSameTitle: "A task with the same title already exists. Check whether it covers this gap.",
      splitBasis: "Requirement covered by this task",
      splitLocate: "Open requirement to review",
      splitOld: "Review the current requirement and progress to update these older suggestions.",
      errSplitReviewRequired: "Open the requirement to review and adopt each suggestion.",
      draftTitle: "Title",
      draftGoal: "Goal",
      draftScope: "Scope",
      draftProblem: "What needs fixing",
      draftSteps: "How to reproduce it",
      draftCriteria: "Completion criteria",
      draftDescription: "Description",
      draftCause: "Cause",
      draftResult: "Result",
      draftLimits: "Known limits",
      eventEvidence: "Added {n} records",
      eventEvidenceAdded: "Added {n} evidence items",
      eventAdopted: "Accepted a suggestion",
      requirementOverview: "Requirement overview",
      requirementScope: "Scope",
      requirementCriteria: "Completion criteria",
      requirementMissing: "Still missing: {fields}",
      requirementExtra: "Additional information",
      requirementBackground: "Background",
      decisionNotes: "Decision notes",
      fieldSeparator: ", ",
      reviewRecords: "Review and acceptance records",
      reviewOpinion: "Decision notes",
      taskWhat: "What to do",
      taskSteps: "Steps or use cases",
      taskMissing: "No task description has been recorded.",
      sidebarTaskDescription: "Task description",
      sidebarFinding: "Recorded finding",
      sidebarNotRecorded: "Nothing recorded yet.",
      sidebarRequirementScope: "Current scope of the parent requirement",
      sidebarReviewDetails: "Review information",
      taskOverviewField: "Task overview",
      taskCriteriaOptional: "Completion criteria (can be added later)",
      taskCause: "Root cause",
      taskSupplement: "Additional notes",
      taskRefsInput: "References (one per line)",
      newTask: "New task",
      backToTasks: "Back to task list",
      recordTaskResult: "Record result",
      useRecordedEvidence: "The verification already recorded for this round can be used.",
      oldTaskProgress: "Earlier progress",
      hideOldTaskProgress: "Hide earlier progress",
      progressSummary: "Progress summary",
      progressDetail: "Details (optional)",
      progressDetailHint: "What changed, what was verified, and what still needs work?",
      progressRecordedAt: "Recorded at",
      noTaskProgress: "No progress has been recorded yet.",
      taskAdditional: "Additional information",
      taskCancelReason: "Cancellation reason",
      taskNoReason: "No reason was recorded.",
      progressRecords: "Progress records",
      latestProgress: "Latest progress",
      recordProgress: "Record progress",
      missingDeliverySummary: "No delivery summary has been recorded.",
      missingCancelImpact: "The impact of cancelled tasks has not been recorded.",
      missingCriteria: "No completion criteria have been recorded.",
      resultUnverified: "The recorded result has not been verified for this round.",
      errRequiredFields: "Fill in {fields} to continue.",
      errTitleRequired: "Enter a title first.",
      errReasonRequired: "Enter a reason or describe the changes you need.",
      errBlockedReason: "Explain what is holding up the task.",
      errEnterProgress: "Enter an update first.",
      errRefresh: "This content changed. Refresh and review the latest version.",
      errReviewUpdated: "The content changed. The latest version is shown; review it before confirming again.",
      errDeliveryStatusChanged: "This requirement is no longer in development. Your draft was not saved; copy it if needed, close this window and review the current delivery.",
      errDeliveryDataIncomplete: "A task could not be read. Restore it, then review the delivery again.",
      errDraftStale: "This suggestion is out of date. Open the latest version before drafting again.",
      errResultEvidence: "Add the result and verification evidence for this round.",
      errCriteriaRequired: "Add completion criteria first.",
      errOldResult: "Record a new result and evidence for the current round.",
      errDeliverySummary: "Provide a summary for this round.",
      errCancelImpact: "Explain how the cancelled tasks affect this round.",
      errOpenTasks: "Finish or cancel the remaining tasks first.",
      errNoTasks: "There are no tasks to review.",
      errAllCancelled: "Complete at least one task before submitting.",
      errTasksNotAccepted: "Every task must pass acceptance first. Cancelled tasks must be restored and accepted.",
      errNotActive: "Tasks can only be processed while the requirement is in development. If it is awaiting acceptance or completed, return it on the board or reopen development first.",
      errNotAllowed: "This action is unavailable in the current state.",
      errAlreadyRunning: "A task is still running. Wait or stop it first.",
      errSessionBusy: "This conversation is busy. Wait or stop the current work first.",
      errSelectTask: "Open the task in a conversation first.",
      errSwitchTask: "Open the task again to use its current conversation.",
      errWrongWorkspace: "Open a conversation from this workspace.",
      errWaitingRecords: "Task records are still arriving. Try again shortly.",
      errReadOnly: "Open a new round before editing this item.",
      errReadOnlyData: "This record can only be viewed. Check or update the project data.",
      errUnreadable: "Could not read this information. Try again.",
      errMissing: "This item is no longer available. Go back and open it again.",
      errEnableProject: "Enable project management first.",
      errAccessDenied: "Check whether this workspace can be accessed.",
      errCancelled: "The request was cancelled.",
      errPromptRejected: "Could not start the task. Check the conversation and try again.",
      errAwaitDraft: "A draft is already being prepared.",
      errAssistFailed: "Could not prepare a draft. Retry or enter the information yourself.",
      errReviewChanged: "A substantive change to the requirement needs another review.",
      errReopenPending: "Finish the existing operation first.",
      errReopenSelection: "Choose tasks to reopen or add a task.",
      errReopenItems: "Some tasks could not be reopened. Retry to finish the same request.",
      errInvalidRef: "Enter a file location within this project.",
      errInvalidInput: "Check the information you entered and try again.",
      errTrashDraft: "Only unused drafts can be deleted.",
      errExists: "This item already exists."
    },
    zh: {
      splitReview: "\u4EFB\u52A1\u6838\u5BF9\u7ED3\u679C",
      splitDetails: "\u67E5\u770B\u6838\u5BF9\u4F9D\u636E",
      splitVerified: "\u5DF2\u9A8C\u8BC1",
      splitAssigned: "\u5DF2\u6709\u4EFB\u52A1\u8D1F\u8D23",
      splitGap: "\u4ECD\u6709\u7F3A\u53E3",
      splitUnknown: "\u5F85\u6838\u5B9E",
      splitWorking: "\u6B63\u5728\u6838\u5BF9\u5DF2\u6709\u4EFB\u52A1\u548C\u9879\u76EE\u8FDB\u5C55\u2026",
      splitNoNew: "\u65E0\u9700\u65B0\u589E\u4EFB\u52A1\u3002",
      splitNoDrafts: "\u6682\u65E0\u53EF\u91C7\u7528\u7684\u65B0\u4EFB\u52A1\u5EFA\u8BAE\u3002",
      splitRethink: "\u8865\u5145\u8BF4\u660E\u5E76\u91CD\u62DF",
      splitFeedback: "\u5E0C\u671B AI \u91CD\u65B0\u8003\u8651\u4EC0\u4E48\uFF1F",
      splitFeedbackHint: "\u4F8B\u5982\uFF0C\u628A\u8FD9\u4E24\u4E2A\u68C0\u67E5\u5408\u5230\u540C\u4E00\u4E2A\u4EFB\u52A1\u3002",
      splitRetry: "\u91CD\u65B0\u6838\u5BF9",
      splitAdopt: "\u91C7\u7528\u5E76\u65B0\u5EFA",
      splitNowAssigned: "\u8BE5\u7F3A\u53E3\u5DF2\u5B89\u6392\u5230\u65B0\u4EFB\u52A1\u3002",
      splitCheckSameTitle: "\u5DF2\u6709\u540C\u540D\u4EFB\u52A1\uFF0C\u8BF7\u6838\u5BF9\u5B83\u662F\u5426\u8986\u76D6\u8BE5\u7F3A\u53E3\u3002",
      splitBasis: "\u5BF9\u5E94\u7684\u9700\u6C42",
      splitLocate: "\u56DE\u9700\u6C42\u67E5\u770B\u6838\u5BF9\u7ED3\u679C",
      splitOld: "\u8FD9\u4E9B\u5EFA\u8BAE\u9700\u8981\u6309\u5F53\u524D\u9700\u6C42\u548C\u4EFB\u52A1\u8FDB\u5C55\u91CD\u65B0\u6838\u5BF9\u3002",
      errSplitReviewRequired: "\u8BF7\u56DE\u5230\u9700\u6C42\u8BE6\u60C5\u6838\u5BF9\u5E76\u9010\u6761\u91C7\u7528\u3002",
      draftTitle: "\u6807\u9898",
      draftGoal: "\u60F3\u8FBE\u5230\u4EC0\u4E48\u6548\u679C",
      draftScope: "\u8FD9\u6B21\u505A\u54EA\u4E9B",
      draftProblem: "\u9047\u5230\u4E86\u4EC0\u4E48\u95EE\u9898",
      draftSteps: "\u600E\u6837\u9047\u5230\u8FD9\u4E2A\u95EE\u9898",
      draftCriteria: "\u600E\u6837\u7B97\u505A\u597D",
      draftDescription: "\u8BF4\u660E",
      draftCause: "\u4E3A\u4EC0\u4E48\u4F1A\u8FD9\u6837",
      draftResult: "\u5904\u7406\u7ED3\u679C",
      draftLimits: "\u8FD8\u6709\u54EA\u4E9B\u9650\u5236",
      eventEvidence: "\u65B0\u589E {n} \u6761\u5904\u7406\u8BB0\u5F55",
      eventEvidenceAdded: "\u65B0\u589E {n} \u6761\u4F9D\u636E",
      eventAdopted: "\u5DF2\u91C7\u7528\u5EFA\u8BAE",
      requirementOverview: "\u9700\u6C42\u6982\u8FF0",
      requirementScope: "\u8FB9\u754C",
      requirementCriteria: "\u5B8C\u6210\u6807\u51C6",
      requirementMissing: "\u8FD8\u7F3A\u5C11{fields}\u3002",
      requirementExtra: "\u8865\u5145\u4FE1\u606F",
      requirementBackground: "\u80CC\u666F",
      decisionNotes: "\u51B3\u7B56\u8BB0\u5F55",
      fieldSeparator: "\u3001",
      reviewRecords: "\u8BC4\u5BA1\u4E0E\u9A8C\u6536\u8BB0\u5F55",
      reviewOpinion: "\u610F\u89C1",
      taskWhat: "\u8981\u505A\u4EC0\u4E48",
      taskSteps: "\u64CD\u4F5C\u6B65\u9AA4\u6216\u4F7F\u7528\u573A\u666F",
      taskMissing: "\u5C1A\u672A\u8BB0\u5F55\u4EFB\u52A1\u8BF4\u660E\u3002",
      sidebarTaskDescription: "\u4EFB\u52A1\u63CF\u8FF0",
      sidebarFinding: "\u5DF2\u8BB0\u5F55\u7684\u53D1\u73B0",
      sidebarNotRecorded: "\u5C1A\u672A\u8BB0\u5F55\u3002",
      sidebarRequirementScope: "\u6240\u5C5E\u9700\u6C42\u7684\u5F53\u524D\u8FB9\u754C",
      sidebarReviewDetails: "\u6838\u5BF9\u4FE1\u606F",
      taskOverviewField: "\u4EFB\u52A1\u6982\u8FF0",
      taskCriteriaOptional: "\u5B8C\u6210\u6807\u51C6\uFF08\u53EF\u540E\u8865\uFF09",
      taskCause: "\u6839\u56E0",
      taskSupplement: "\u9644\u52A0\u8BF4\u660E",
      taskRefsInput: "\u5173\u8054\u8D44\u6599\uFF08\u6BCF\u884C\u4E00\u9879\uFF09",
      newTask: "\u65B0\u5EFA\u4EFB\u52A1",
      backToTasks: "\u8FD4\u56DE\u4EFB\u52A1\u5217\u8868",
      recordTaskResult: "\u8BB0\u5F55\u7ED3\u679C",
      useRecordedEvidence: "\u53EF\u4EE5\u4F7F\u7528\u672C\u8F6E\u5DF2\u4FDD\u5B58\u7684\u9A8C\u8BC1\u4F9D\u636E\u3002",
      oldTaskProgress: "\u66F4\u65E9\u8FDB\u5C55",
      hideOldTaskProgress: "\u6536\u8D77\u66F4\u65E9\u8FDB\u5C55",
      progressSummary: "\u8FDB\u5C55\u6458\u8981",
      progressDetail: "\u8BE6\u60C5\uFF08\u9009\u586B\uFF09",
      progressDetailHint: "\u53EF\u8865\u5145\u5904\u7406\u4E86\u4EC0\u4E48\u3001\u9A8C\u8BC1\u7ED3\u679C\u548C\u4ECD\u6709\u7684\u7F3A\u53E3\u3002",
      progressRecordedAt: "\u8BB0\u5F55\u4E8E",
      noTaskProgress: "\u6682\u65E0\u8FDB\u5C55\u8BB0\u5F55\u3002",
      taskAdditional: "\u8865\u5145\u4FE1\u606F",
      taskCancelReason: "\u53D6\u6D88\u539F\u56E0",
      taskNoReason: "\u5C1A\u672A\u8BB0\u5F55\u539F\u56E0\u3002",
      progressRecords: "\u8FDB\u5C55\u8BB0\u5F55",
      latestProgress: "\u6700\u8FD1\u8FDB\u5C55",
      recordProgress: "\u8BB0\u5F55\u8FDB\u5C55",
      missingDeliverySummary: "\u5C1A\u672A\u8BB0\u5F55\u672C\u8F6E\u4EA4\u4ED8\u6458\u8981\u3002",
      missingCancelImpact: "\u5C1A\u672A\u8BB0\u5F55\u53D6\u6D88\u4EFB\u52A1\u5BF9\u8303\u56F4\u7684\u5F71\u54CD\u3002",
      missingCriteria: "\u5C1A\u672A\u8BB0\u5F55\u5B8C\u6210\u6807\u51C6\u3002",
      resultUnverified: "\u5DF2\u8BB0\u5F55\u5904\u7406\u7ED3\u679C\uFF0C\u672C\u8F6E\u4F9D\u636E\u5C1A\u672A\u6838\u5B9E\u3002",
      errRequiredFields: "\u8BF7\u5148\u8865\u5168{fields}\u3002",
      errTitleRequired: "\u8BF7\u5148\u586B\u5199\u6807\u9898\u3002",
      errReasonRequired: "\u8BF7\u586B\u5199\u539F\u56E0\u6216\u9700\u8981\u4FEE\u6539\u7684\u5185\u5BB9\u3002",
      errBlockedReason: "\u8BF7\u8BF4\u660E\u4EFB\u52A1\u5361\u5728\u54EA\u91CC\u3002",
      errEnterProgress: "\u8BF7\u5148\u586B\u5199\u8FDB\u5C55\u3002",
      errRefresh: "\u5185\u5BB9\u5DF2\u6709\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6838\u5BF9\u3002",
      errReviewUpdated: "\u5185\u5BB9\u5DF2\u6709\u66F4\u65B0\uFF0C\u5DF2\u663E\u793A\u6700\u65B0\u5185\u5BB9\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u540E\u518D\u786E\u8BA4\u3002",
      errDeliveryStatusChanged: "\u9700\u6C42\u5DF2\u4E0D\u5728\u5F00\u53D1\u4E2D\uFF0C\u4E0B\u9762\u586B\u5199\u7684\u5185\u5BB9\u672A\u4FDD\u5B58\u3002\u9700\u8981\u65F6\u8BF7\u5148\u590D\u5236\uFF0C\u518D\u5173\u95ED\u7A97\u53E3\u5E76\u6838\u5BF9\u5F53\u524D\u4EA4\u4ED8\u5185\u5BB9\u3002",
      errDeliveryDataIncomplete: "\u6709\u4EFB\u52A1\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6838\u5BF9\u4EA4\u4ED8\u5185\u5BB9\u3002",
      errDraftStale: "\u5EFA\u8BAE\u5DF2\u8FC7\u65F6\uFF0C\u8BF7\u6253\u5F00\u6700\u65B0\u5185\u5BB9\u540E\u91CD\u65B0\u8D77\u8349\u3002",
      errResultEvidence: "\u8BF7\u8865\u5145\u672C\u6B21\u7ED3\u679C\u548C\u9A8C\u8BC1\u4F9D\u636E\u3002",
      errCriteriaRequired: "\u8BF7\u5148\u8865\u5145\u5B8C\u6210\u6807\u51C6\u3002",
      errOldResult: "\u8BF7\u8865\u5145\u8FD9\u4E00\u8F6E\u7684\u65B0\u7ED3\u679C\u548C\u9A8C\u8BC1\u4F9D\u636E\u3002",
      errDeliverySummary: "\u8BF7\u586B\u5199\u672C\u8F6E\u4EA4\u4ED8\u6458\u8981\u3002",
      errCancelImpact: "\u8BF7\u8BF4\u660E\u5DF2\u53D6\u6D88\u7684\u4EFB\u52A1\u5BF9\u672C\u8F6E\u6709\u4EC0\u4E48\u5F71\u54CD\u3002",
      errOpenTasks: "\u8BF7\u5148\u5B8C\u6210\u6216\u53D6\u6D88\u5269\u4F59\u4EFB\u52A1\u3002",
      errNoTasks: "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u53EF\u9A8C\u6536\u7684\u4EFB\u52A1\u3002",
      errAllCancelled: "\u8BF7\u5148\u5B8C\u6210\u81F3\u5C11\u4E00\u9879\u4EFB\u52A1\u3002",
      errTasksNotAccepted: "\u8BF7\u5148\u901A\u8FC7\u5168\u90E8\u5B50\u4EFB\u52A1\u7684\u9A8C\u6536\u3002\u5DF2\u53D6\u6D88\u7684\u4EFB\u52A1\u987B\u6062\u590D\u540E\u9A8C\u6536\u3002",
      errNotActive: "\u4EFB\u52A1\u53EA\u5728\u6240\u5C5E\u9700\u6C42\u5F00\u53D1\u4E2D\u65F6\u53EF\u5904\u7406\u3002\u5F85\u9A8C\u6536\u6216\u5DF2\u5B8C\u6210\u65F6\uFF0C\u8BF7\u5148\u5230\u9700\u6C42\u770B\u677F\u6253\u56DE\u6216\u91CD\u65B0\u5F00\u53D1\uFF1B\u67E5\u770B\u4E0D\u4F1A\u81EA\u52A8\u6267\u884C\u3002",
      errNotAllowed: "\u5F53\u524D\u72B6\u6001\u65E0\u6CD5\u8FDB\u884C\u8FD9\u9879\u64CD\u4F5C\u3002",
      errAlreadyRunning: "\u4EFB\u52A1\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7B49\u5F85\u6216\u505C\u6B62\u540E\u518D\u8BD5\u3002",
      errSessionBusy: "\u4F1A\u8BDD\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7B49\u5F85\u6216\u505C\u6B62\u540E\u518D\u8BD5\u3002",
      errSelectTask: "\u8BF7\u5148\u5728\u4F1A\u8BDD\u4E2D\u6253\u5F00\u8FD9\u9879\u4EFB\u52A1\u3002",
      errSwitchTask: "\u4EFB\u52A1\u5173\u8054\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u4EFB\u52A1\u3002",
      errWrongWorkspace: "\u8BF7\u4F7F\u7528\u6B64\u5DE5\u4F5C\u533A\u7684\u4F1A\u8BDD\u3002",
      errWaitingRecords: "\u6B63\u5728\u4FDD\u5B58\u4EFB\u52A1\u8BB0\u5F55\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
      errReadOnly: "\u8BF7\u53D1\u8D77\u65B0\u4E00\u8F6E\u540E\u518D\u7F16\u8F91\u3002",
      errReadOnlyData: "\u6B64\u8BB0\u5F55\u53EA\u80FD\u67E5\u770B\uFF0C\u8BF7\u68C0\u67E5\u9879\u76EE\u6570\u636E\u6216\u66F4\u65B0\u5DE5\u4F5C\u53F0\u3002",
      errUnreadable: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u8BF7\u91CD\u8BD5\u3002",
      errMissing: "\u627E\u4E0D\u5230\u6B64\u9879\u5185\u5BB9\uFF0C\u8BF7\u8FD4\u56DE\u540E\u91CD\u65B0\u6253\u5F00\u3002",
      errEnableProject: "\u8BF7\u5148\u542F\u7528\u9879\u76EE\u7BA1\u7406\u3002",
      errAccessDenied: "\u8BF7\u68C0\u67E5\u5F53\u524D\u5DE5\u4F5C\u533A\u662F\u5426\u53EF\u8BBF\u95EE\u3002",
      errCancelled: "\u8BF7\u6C42\u5DF2\u53D6\u6D88\u3002",
      errPromptRejected: "\u4EFB\u52A1\u672A\u80FD\u5F00\u59CB\uFF0C\u8BF7\u67E5\u770B\u4F1A\u8BDD\u540E\u91CD\u8BD5\u3002",
      errAwaitDraft: "\u6B63\u5728\u8D77\u8349\uFF0C\u8BF7\u7A0D\u7B49\u3002",
      errAssistFailed: "\u6682\u65F6\u65E0\u6CD5\u751F\u6210\u8349\u7A3F\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u6216\u624B\u5DE5\u586B\u5199\u3002",
      errReviewChanged: "\u9700\u6C42\u5185\u5BB9\u6709\u5B9E\u8D28\u4FEE\u6539\uFF0C\u9700\u8981\u91CD\u65B0\u8BC4\u5BA1\u3002",
      errReopenPending: "\u8BF7\u5148\u5B8C\u6210\u4E0A\u4E00\u6B21\u64CD\u4F5C\u3002",
      errReopenSelection: "\u8BF7\u9009\u62E9\u8981\u91CD\u5F00\u7684\u4EFB\u52A1\uFF0C\u6216\u65B0\u589E\u4E00\u9879\u4EFB\u52A1\u3002",
      errReopenItems: "\u8FD8\u6709\u4EFB\u52A1\u672A\u80FD\u91CD\u5F00\uFF0C\u91CD\u8BD5\u53EF\u7EE7\u7EED\u672C\u6B21\u64CD\u4F5C\u3002",
      errInvalidRef: "\u8BF7\u586B\u5199\u6B64\u9879\u76EE\u5185\u7684\u6587\u4EF6\u4F4D\u7F6E\u3002",
      errInvalidInput: "\u8BF7\u68C0\u67E5\u8F93\u5165\u5185\u5BB9\u540E\u91CD\u8BD5\u3002",
      errTrashDraft: "\u53EA\u6709\u5C1A\u672A\u4F7F\u7528\u7684\u9700\u6C42\u8349\u7A3F\u53EF\u4EE5\u5220\u9664\u3002",
      errExists: "\u540C\u4E00\u9879\u5185\u5BB9\u5DF2\u5B58\u5728\u3002"
    }
  };
  var draftFields = {
    title: "draftTitle",
    overview: "requirementOverview",
    q_pain: "requirementOverview",
    goal: "draftGoal",
    scope: "draftScope",
    problemOverview: "draftProblem",
    triggerPath: "draftSteps",
    acceptance: "draftCriteria",
    description: "draftDescription",
    rootCause: "draftCause",
    resultSummary: "draftResult",
    knownLimits: "draftLimits"
  };
  var isRequirementSplit = (proposal) => proposal?.kind === "new_task" && (!!proposal.split || proposal.evidence?.includes("draft://requirement/" + proposal.target?.reqId));
  var draftFieldLabel = (field, t) => t(Object.hasOwn(draftFields, field) ? draftFields[field] : "draftDescription");
  var requirementLabels = ["backlog", "reviewing", "ready", "in_progress", "pending", "completed"];
  var taskLabels = ["todo", "doing", "blocked", "in_review", "done", "cancelled"];
  function activityParts(rawLine, kind) {
    const raw = textOf(rawLine);
    const dated = raw.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*)\s+(.*)$/s);
    const at = dated?.[1] ?? "";
    const date = at.slice(0, 16).replace("T", " ");
    const body = dated ? dated[2] : raw;
    const states = body.match(/^([a-z_]+)\s+→\s+([a-z_]+)(.*)$/s);
    const labels = kind === "requirement" ? requirementLabels : kind === "task" || kind === "issue" ? taskLabels : [...requirementLabels, ...taskLabels];
    return { raw, at, date, body, states: states && labels.includes(states[1]) && labels.includes(states[2]) ? states : null };
  }
  function activityEntry(rawLine, t, kind) {
    const { raw, date, body, states } = activityParts(rawLine, kind);
    const state = (name) => t((taskLabels.includes(name) ? "st_" : "col_") + name);
    const count = body.match(/^客观记录同步：会话 .* 第 \d+[–-]\d+ 条（新增 (\d+) 条依据）$/)?.[1];
    const missingSummaryCount = body.match(/^(?:undefined|null)?\s*[（(]新增\s*(\d+)\s*条依据[）)]$/)?.[1];
    let text = body;
    if (states) text = `${state(states[1])} \u2192 ${state(states[2])}${states[3]}`;
    else if (count) text = t("eventEvidence").replace("{n}", count);
    else if (missingSummaryCount) text = t("eventEvidenceAdded").replace("{n}", missingSummaryCount);
    else if (/^建议已采用：prop-[a-z0-9-]+$/.test(body)) text = t("eventAdopted");
    return { date, text, raw };
  }
  var recordedDecisions = {
    "reviewing>ready": ["review", "approved"],
    "reviewing>backlog": ["review", "returned"],
    "ready>backlog": ["review", "returned"],
    "in_progress>backlog": ["review", "returned"],
    "pending>completed": ["acceptance", "approved"],
    "pending>in_progress": ["acceptance", "returned"],
    "completed>in_progress": ["acceptance", "returned"]
  };
  function reviewRecords(reviews = []) {
    const seen = /* @__PURE__ */ new Set();
    return [...reviews].reverse().filter((record) => {
      if (!["review", "acceptance"].includes(record.kind) || !["approved", "returned"].includes(record.decision)) return false;
      const identity = record.marker || record.round || JSON.stringify([record.kind, record.decision, record.at, record.opinion, record.summary]);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  function progressRecords(activity = [], t, kind, reviews = []) {
    const usedReviews = /* @__PURE__ */ new Set();
    return activity.flatMap((line, index) => {
      const { at, date, body, states } = activityParts(line, kind);
      if (!body || /^(?:客观记录同步：会话 |建议已采用：prop-)/.test(body)) return [];
      if (states && kind === "requirement") {
        const decision = recordedDecisions[`${states[1]}>${states[2]}`];
        const note = states[3].match(/^（(.*)）$/)?.[1];
        const matched = decision && reviews.find((record) => !usedReviews.has(record) && record.kind === decision[0] && record.decision === decision[1] && (!note || record.decision === "approved" || note === textOf(record.opinion)) && Math.abs(Date.parse(at) - Date.parse(record.at)) < 6e4);
        if (matched) {
          usedReviews.add(matched);
          return [];
        }
      }
      let { text } = activityEntry(line, t, kind);
      if (states) text = text.replace(/(?:：proposal:prop-[a-z0-9-]+(?=）)|（proposal:prop-[a-z0-9-]+）)$/i, "");
      else text = text.replace(/^\[AI\]\s*|^人工操作：\s*/, "");
      return text ? [{ date, text, key: index, event: !!states || /^重开完成：/.test(body) }] : [];
    });
  }
  function taskProgressRecords(activity, t) {
    const copies = /* @__PURE__ */ new Map();
    return progressRecords(activity, t, "issue").reverse().map((entry) => {
      const raw = activity[entry.key];
      const occurrence = copies.get(raw) ?? 0;
      copies.set(raw, occurrence + 1);
      const { at, states } = activityParts(raw, "issue");
      const [first, ...detail] = entry.text.split(/\r?\n/);
      const summary = states ? `${t("st_" + states[1])} \u2192 ${t("st_" + states[2])}` : first;
      return { id: JSON.stringify([raw, occurrence]), date: entry.date, at, summary, detail: detail.join("\n").trim() || entry.text };
    }).reverse();
  }
  function cancellationReason(task) {
    for (const line of task.activity ?? []) {
      const { states } = activityParts(line, "issue");
      if (!states || states[2] !== "cancelled") continue;
      const [metadata, ...details] = states[3].split("\n");
      const savedReason = details.join("\n").trim();
      if (savedReason) return savedReason;
      const reason = textOf(metadata.match(/^\s*[（(]([\s\S]*)[）)]\s*$/)?.[1]).replace(/^(人工|AI|系统)[：:]\s*/, "");
      return /^(人工|AI|系统|proposal:prop-[a-z0-9-]+)$/i.test(reason) ? "" : reason;
    }
    return "";
  }
  function readingBlocks(value) {
    const blocks = [];
    for (const line of textOf(value).split(/\r?\n/)) {
      if (!line.trim()) {
        if (blocks.at(-1)?.lines.length) blocks.push({ tag: "p", lines: [] });
        continue;
      }
      const ordered = line.match(/^\s*(\d+)(?:[.)]\s+|[、．）]\s*)(.+)$/);
      const bullet = line.match(/^\s*(?:[-*+]\s+|•\s*)(.+)$/);
      const tag = ordered ? "ol" : bullet ? "ul" : "p";
      let block = blocks.at(-1);
      if (block?.tag !== tag) {
        if (!block?.lines.length) blocks.pop();
        block = { tag, lines: [] };
        blocks.push(block);
      }
      block.lines.push(ordered ? { number: Number(ordered[1]), text: ordered[2] } : bullet?.[1] ?? line);
    }
    return blocks.filter((block) => block.lines.length);
  }
  var errors = {
    TITLE_REQUIRED: "errTitleRequired",
    REASON_REQUIRED: "errReasonRequired",
    BLOCKED_REASON_REQUIRED: "errBlockedReason",
    EMPTY_UPDATE: "errEnterProgress",
    CONFLICT: "errRefresh",
    FINGERPRINT_REQUIRED: "errRefresh",
    ROUND_CHANGED: "errRefresh",
    REVIEW_CONTENT_UPDATED: "errReviewUpdated",
    DELIVERY_STATUS_CHANGED: "errDeliveryStatusChanged",
    DELIVERY_DATA_INCOMPLETE: "errDeliveryDataIncomplete",
    DRAFT_STALE: "errDraftStale",
    ASSIST_STALE: "errDraftStale",
    SPLIT_REVIEW_REQUIRED: "errSplitReviewRequired",
    ACCEPTANCE_REQUIRED: "errCriteriaRequired",
    RESULT_EVIDENCE_REQUIRED: "errResultEvidence",
    EVIDENCE_REQUIRED: "errResultEvidence",
    RESULT_STALE: "errOldResult",
    SUMMARY_REQUIRED: "errDeliverySummary",
    SUMMARY_STALE: "errDeliverySummary",
    CANCEL_IMPACT_REQUIRED: "errCancelImpact",
    CANCEL_IMPACT_STALE: "errCancelImpact",
    ISSUES_NOT_TERMINAL: "errOpenTasks",
    NO_ISSUES: "errNoTasks",
    ALL_CANCELLED: "errAllCancelled",
    TASKS_NOT_ACCEPTED: "errTasksNotAccepted",
    REQ_NOT_ACTIVE: "errNotActive",
    ILLEGAL_TRANSITION: "errNotAllowed",
    INVALID_STATE: "errNotAllowed",
    HUMAN_ONLY: "errNotAllowed",
    RUNNING: "errAlreadyRunning",
    RUNNING_ISSUES: "errAlreadyRunning",
    SESSION_BUSY: "errSessionBusy",
    NOT_LINKED: "errSelectTask",
    NO_LINK: "errSelectTask",
    SESSION_NOT_LIVE: "errSwitchTask",
    LINK_CHANGED: "errSwitchTask",
    WORKSPACE_MISMATCH: "errWrongWorkspace",
    SYNC_PENDING: "errWaitingRecords",
    SYNC_UNSTABLE: "errWaitingRecords",
    TERMINAL_READ_ONLY: "errReadOnly",
    SCHEMA_TOO_NEW: "errReadOnlyData",
    MISSING_FRONTMATTER: "errReadOnlyData",
    INVALID_STATUS: "errReadOnlyData",
    READ_FAILED: "errUnreadable",
    NOT_FOUND: "errMissing",
    WORKSPACE_MISSING: "errMissing",
    NOT_INITIALIZED: "errEnableProject",
    ACCESS_DENIED: "errAccessDenied",
    CANCELLED: "errCancelled",
    PROMPT_REJECTED: "errPromptRejected",
    ASSIST_BUSY: "errAwaitDraft",
    ASSIST_FAILED: "errAssistFailed",
    SPAWN_FAILED: "errAssistFailed",
    REVIEW_INVALIDATION_REQUIRED: "errReviewChanged",
    REOPEN_PENDING: "errReopenPending",
    REOPEN_CONFLICT: "errReopenPending",
    DECISION_PENDING: "errReopenPending",
    REOPEN_SELECTION_REQUIRED: "errReopenSelection",
    REOPEN_ITEM_FAILED: "errReopenItems",
    ABSOLUTE_REF: "errInvalidRef",
    INVALID_REF: "errInvalidRef",
    FIELD_NOT_EDITABLE: "errInvalidInput",
    INVALID_ID: "errInvalidInput",
    INVALID_ROOT: "errInvalidInput",
    INVALID_PROPOSAL: "errInvalidInput",
    NOT_A_DRAFT: "errTrashDraft",
    INVALID_KIND: "errTrashDraft",
    ALREADY_EXISTS: "errExists"
  };
  function workbenchError(error, t) {
    const code = textOf(error?.code);
    const message = textOf(error?.message) || textOf(error);
    const raw = [code, message, textOf(error?.method) && `\u63A5\u53E3\uFF1A${textOf(error.method)}`].filter(Boolean).join("\n");
    if (code === "REOPEN_ITEM_FAILED") {
      const access = /EACCES|EPERM|EROFS|EBUSY|immutable|permission|read.?only|权限|不可变/i.test(message);
      return { text: `${t("errReopenItems")}${access ? " \u5DE5\u4F5C\u533A\u6216\u4EFB\u52A1\u6587\u4EF6\u5F53\u524D\u4E0D\u53EF\u5199\uFF0C\u8BF7\u6062\u590D\u6743\u9650\u6216\u6587\u4EF6\u9650\u5236\u540E\u91CD\u8BD5\u3002" : " \u8BF7\u6838\u5BF9\u672A\u5B8C\u6210\u4EFB\u52A1\u540E\u91CD\u8BD5\u3002"} \u5DF2\u5904\u7406\u90E8\u5206\u4E0D\u4F1A\u91CD\u590D\uFF0C\u65B0\u5EFA\u4EFB\u52A1\u6CBF\u7528\u539F ID\u3002`, raw };
    }
    if (code === "MISSING_START_FIELDS" || code === "MISSING_TASK_FIELDS" || code === "REVIEW_INFO_REQUIRED") {
      const fields = message.split(": ").at(-1).split(", ").filter((field) => Object.hasOwn(draftFields, field)).map((field) => {
        if (field === "problemOverview") return t("taskOverviewField");
        if (field === "acceptance") return t("requirementCriteria");
        return draftFieldLabel(field, t);
      });
      if (fields.length) return { text: t("errRequiredFields").replace("{fields}", fields.join("\u3001")), raw };
    }
    return { text: t(Object.hasOwn(errors, code) ? errors[code] : "errGeneric"), raw };
  }

  // client-src/shared/ui.js
  var import_react = __toESM(__require("react"), 1);
  var h = import_react.default.createElement;
  var { useEffect } = import_react.default;
  function Disclosure({ label, children, open }) {
    return h(
      "details",
      { className: "pw-disclosure", ...open === void 0 ? {} : { open } },
      h("summary", null, label),
      children
    );
  }
  function ReadText({ label, value, preview }) {
    if (!String(value ?? "").trim()) return null;
    return h(
      "div",
      null,
      label && h("strong", null, label),
      h("p", { className: preview ? "pw-text pw-preview" : "pw-text" }, value)
    );
  }
  function ErrorDetails({ error, t, showRaw = true }) {
    if (!error) return null;
    const { text, raw } = workbenchError(typeof error === "string" ? { message: error } : error, t);
    return h(
      "div",
      { className: "pw-error", role: "alert" },
      h("div", null, text),
      showRaw && raw && h(Disclosure, { label: t("rawDetails") }, h(ReadText, { value: raw }))
    );
  }
  function Modal({ title, children, onClose, actions, wide }) {
    useEffect(() => {
      const onKey = (event) => {
        if (event.key === "Escape") onClose();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    return h(
      import_react.default.Fragment,
      null,
      h("div", { className: "pw-modal-mask", onClick: onClose }),
      h(
        "div",
        { className: "pw-modal" + (wide ? " wide" : ""), role: "dialog", "aria-modal": true, "aria-label": title, "data-window-drag-exclude": true },
        h("h3", null, title),
        wide ? h("div", { className: "pw-modal-body" }, children) : children,
        h("div", { className: "pw-modal-actions" }, actions)
      )
    );
  }
  function LeaveModal({ modal, t, busy, onStay, onSave, onDiscard }) {
    return h(Modal, { title: t("leaveTitle"), onClose: () => {
      if (!busy) onStay();
    }, actions: [
      h("button", { className: "pw-button", onClick: onStay, disabled: busy }, t("keepEditing")),
      h("button", { className: "pw-button danger", onClick: onDiscard, disabled: busy }, t("discardDraft")),
      h("button", { className: "pw-button primary", onClick: onSave, disabled: busy }, t("saveAndLeave"))
    ] }, h("p", null, t("leaveBody")), modal.error && h("p", { className: "pw-error" }, modal.error));
  }

  // client-src/shared/modals.js
  var import_react6 = __toESM(__require("react"), 1);

  // client-src/forms/task-form.js
  var import_react2 = __toESM(__require("react"), 1);
  var h2 = import_react2.default.createElement;
  var { useEffect: useEffect2, useRef, useState } = import_react2.default;
  function EditableField({ form, name, label, rows, disabled, required, autoFocus }) {
    const props = {
      className: rows ? "pw-textarea" : "pw-input",
      value: form.draft[name] ?? "",
      name,
      disabled,
      required,
      autoFocus,
      onChange: (event) => form.change(name, event.target.value)
    };
    return h2(
      "label",
      { className: "pw-field" },
      h2(
        "span",
        { className: "pw-label" },
        label,
        required && h2("span", { "aria-hidden": true }, " *")
      ),
      rows ? h2("textarea", { ...props, rows }) : h2("input", props)
    );
  }
  function TaskFields({ form, t, busy, focus = "title" }) {
    const field = (name, label, rows, required) => h2(EditableField, { form, name, label: t(label), rows, required, disabled: busy, autoFocus: focus === name });
    return h2(
      "div",
      { className: "pw-task-fields" },
      field("title", "issueTitle", 0, true),
      field("problemOverview", "taskOverviewField", 1, true),
      field("acceptance", "taskCriteriaOptional", 2),
      h2(
        Disclosure,
        { label: t("taskAdditional") },
        field("triggerPath", "taskSteps", 2),
        field("rootCause", "taskCause", 2),
        field("description", "taskSupplement", 2),
        field("refs", "taskRefsInput", 2)
      )
    );
  }
  function TaskForm({ form, t, busy, error, focus, onSave, onCancel }) {
    return h2(
      "form",
      { noValidate: true, onSubmit: (event) => {
        event.preventDefault();
        onSave();
      } },
      h2(TaskFields, { form, t, busy, focus }),
      h2(ErrorDetails, { error, t, showRaw: false }),
      h2(
        "div",
        { className: "pw-actions" },
        h2("button", { type: "submit", className: "pw-button primary", disabled: busy }, t("save")),
        h2("button", { type: "button", className: "pw-button pw-quiet", disabled: busy, onClick: onCancel }, t("cancel"))
      )
    );
  }
  function TaskResultForm({ task, t, busy, onSave, onClose, since: requirementSince }) {
    const [original] = useState(task);
    const since = Math.max(Number(original.deliveryStartedAt) || 0, Number(original.requirementDeliveryStartedAt) || 0, Number(requirementSince) || 0);
    const objective = original.hasObjective && (Number(original.objectiveAt) || 0) >= since;
    const result = taskResult(original, since);
    const limitsCurrent = Number(original.knownLimitsAt) > 0 && Number(original.knownLimitsAt) >= since;
    const [draft, setDraft] = useState(() => ({
      resultSummary: result.recordedSummary,
      evidence: (Number(original.evidenceAt) || 0) >= since ? original.evidence ?? "" : "",
      knownLimits: limitsCurrent ? original.knownLimits ?? "" : ""
    }));
    const [limitsTouched, setLimitsTouched] = useState(false);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const locked = saving || busy;
    const form = { draft, change: (name, value) => {
      if (name === "knownLimits") setLimitsTouched(true);
      setDraft((previous) => ({ ...previous, [name]: value }));
      setError(null);
    } };
    const submit = async () => {
      if (locked) return;
      if (!draft.resultSummary.trim() || !draft.evidence.trim() && !objective) {
        setError({ code: "RESULT_EVIDENCE_REQUIRED" });
        return;
      }
      setSaving(true);
      const patch = Object.fromEntries(Object.entries(draft).map(([name, value]) => [name, value.trim()]));
      if (!limitsTouched) delete patch.knownLimits;
      const result2 = await onSave({ patch, fileHash: original.hash, recordResult: true });
      if (result2?.ok) onClose();
      else {
        setError(result2 ?? { code: "SESSION_BUSY" });
        setSaving(false);
      }
    };
    const formId = "pw-record-task-result";
    return h2(Modal, { title: t("recordTaskResult"), wide: true, onClose: () => {
      if (!locked) onClose();
    }, actions: [
      h2("button", { type: "button", className: "pw-button pw-quiet", disabled: locked, onClick: onClose }, t("cancel")),
      h2("button", { type: "submit", form: formId, className: "pw-button primary", disabled: locked }, t("save"))
    ] }, h2(
      "form",
      { id: formId, noValidate: true, onSubmit: (event) => {
        event.preventDefault();
        submit();
      } },
      h2(EditableField, { form, name: "resultSummary", label: t("demoResult"), rows: 3, required: true, autoFocus: true, disabled: locked }),
      result.unverifiedResultContext && h2(
        Disclosure,
        { label: t("previousResult") },
        h2("p", { className: "pw-text", style: { whiteSpace: "pre-wrap" } }, result.unverifiedResultContext)
      ),
      objective && h2("p", { className: "pw-note" }, t("useRecordedEvidence")),
      h2(EditableField, { form, name: "evidence", label: t("demoEvidence"), rows: 3, required: !objective, disabled: locked }),
      h2(EditableField, { form, name: "knownLimits", label: t("demoLimits"), rows: 2, disabled: locked }),
      !limitsCurrent && !!original.knownLimits?.trim() && h2(
        Disclosure,
        { label: t("previousLimits") },
        h2("p", { className: "pw-text", style: { whiteSpace: "pre-wrap" } }, original.knownLimits)
      ),
      h2(ErrorDetails, { error, t, showRaw: false })
    ));
  }
  function useTaskDraft(draftKey, item, memory) {
    const remembered = memory.drafts[draftKey];
    const [editing, setEditing] = useState(() => !!remembered);
    const [draft, setDraft] = useState(() => draftOf(memory.drafts, draftKey, issueDraftFrom(item)));
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const base = useRef({ fields: issueDraftFrom(item), fileHash: remembered?.fileHash ?? item.hash });
    const previousHash = useRef(item.hash);
    const dirty = !!memory.drafts[draftKey] || !sameDraft(draft, base.current.fields);
    useEffect2(() => {
      if (previousHash.current === item.hash) return;
      previousHash.current = item.hash;
      if (dirty) {
        setUpdateAvailable(true);
        return;
      }
      base.current = { fields: issueDraftFrom(item), fileHash: item.hash };
      setDraft(base.current.fields);
    }, [item, dirty]);
    const begin = () => {
      base.current = { fields: issueDraftFrom(item), fileHash: item.hash };
      previousHash.current = item.hash;
      setDraft(base.current.fields);
      setUpdateAvailable(false);
      setEditing(true);
    };
    const change = (key, value) => {
      const next = { ...draft, [key]: value };
      const nextDirty = !sameDraft(next, base.current.fields);
      setDraft(next);
      if (nextDirty) memory.drafts[draftKey] = { fields: next, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash };
      else delete memory.drafts[draftKey];
    };
    const finish = () => {
      delete memory.drafts[draftKey];
      setEditing(false);
      setUpdateAvailable(false);
    };
    const loadUpdate = () => {
      delete memory.drafts[draftKey];
      base.current = { fields: issueDraftFrom(item), fileHash: item.hash };
      previousHash.current = item.hash;
      setDraft(base.current.fields);
      setUpdateAvailable(false);
    };
    const params = () => ({ patch: taskContentPatch(draft, item), fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash });
    return { editing, begin, finish, params, draft, change, dirty, updateAvailable, keepUpdate: () => setUpdateAvailable(false), loadUpdate };
  }

  // client-src/forms/requirement-form.js
  var import_react3 = __toESM(__require("react"), 1);
  var h3 = import_react3.default.createElement;
  function requirementFormError(draft) {
    const fields = [!draft.title.trim() && "title", !draft.q_pain.trim() && "overview"].filter(Boolean);
    return fields.length ? { ok: false, code: "REVIEW_INFO_REQUIRED", message: "required: " + fields.join(", ") } : null;
  }
  function RequirementFields({ form, t, busy, req, autoFocus }) {
    const oldCriteria = req?.q_success?.trim();
    const criteria = req?.acceptance?.trim();
    const criteriaField = oldCriteria && !criteria ? "q_success" : "acceptance";
    return h3(
      "div",
      { className: "pw-requirement-fields" },
      h3(EditableField, { form, name: "title", label: t("issueTitle"), disabled: busy, required: true, autoFocus }),
      h3(EditableField, { form, name: "q_pain", label: t("requirementOverview"), rows: 1, disabled: busy, required: true }),
      h3(EditableField, { form, name: "goal", label: t("goal"), rows: 2, disabled: busy }),
      h3(EditableField, { form, name: "scope", label: t("requirementScope"), rows: 2, disabled: busy }),
      h3(
        Disclosure,
        { label: t("requirementExtra") },
        h3(EditableField, { form, name: "q_who", label: t("q_who"), disabled: busy }),
        h3(EditableField, { form, name: criteriaField, label: t("requirementCriteria"), rows: 2, disabled: busy }),
        oldCriteria && criteria && oldCriteria !== criteria && h3(EditableField, { form, name: "q_success", label: t("q_success"), rows: 2, disabled: busy }),
        req?.q_out?.trim() && h3(EditableField, { form, name: "q_out", label: t("q_out"), rows: 2, disabled: busy })
      )
    );
  }

  // client-src/detail/task-content.js
  var import_react4 = __toESM(__require("react"), 1);
  var h4 = import_react4.default.createElement;
  var { useState: useState2 } = import_react4.default;
  function UpdateLog({ activity, onAdd, t, kind = "issue", showRecords = true, userFacing = false, reviews, timeline, openWikiPage }) {
    const [text, setText] = useState2("");
    const [detail, setDetail] = useState2("");
    const [busy, setBusy] = useState2(false);
    const [editing, setEditing] = useState2(false);
    const add = async () => {
      const value = text.trim();
      if (!value || busy) return;
      setBusy(true);
      try {
        const res = await onAdd(timeline && detail.trim() ? `${value}
${detail.trim()}` : value);
        if (res?.ok) {
          setText((current) => current === text ? "" : current);
          setDetail((current) => current === detail ? "" : current);
          if (userFacing) setEditing(false);
        }
      } finally {
        setBusy(false);
      }
    };
    const cancel = () => {
      setEditing(false);
      setText("");
      setDetail("");
    };
    if (timeline) {
      return h4(
        ProgressTimeline,
        { records: taskProgressRecords(activity, t), t, openWikiPage, onAdd },
        editing ? h4(
          "form",
          { className: "pw-progress-form", onSubmit: (event) => {
            event.preventDefault();
            add();
          } },
          h4(
            "label",
            { className: "pw-field" },
            h4("span", { className: "pw-label" }, t("progressSummary")),
            h4("input", { className: "pw-input", autoFocus: true, required: true, readOnly: busy, value: text, onChange: (event) => setText(event.target.value) })
          ),
          h4(
            "label",
            { className: "pw-field" },
            h4("span", { className: "pw-label" }, t("progressDetail")),
            h4("textarea", { className: "pw-textarea", rows: 3, readOnly: busy, value: detail, placeholder: t("progressDetailHint"), onChange: (event) => setDetail(event.target.value) })
          ),
          h4(
            "div",
            { className: "pw-actions" },
            h4("button", { className: "pw-button", type: "submit", disabled: busy || !text.trim() }, t("addUpdate")),
            h4("button", { className: "pw-button pw-quiet", type: "button", disabled: busy, onClick: cancel }, t("cancel"))
          )
        ) : onAdd && h4("button", { className: "pw-button pw-quiet", onClick: () => setEditing(true) }, t("recordProgress"))
      );
    }
    const records = userFacing ? progressRecords(activity, t, kind, reviews) : (activity ?? []).map((line, index) => ({ ...activityEntry(line, t, kind), key: index }));
    const list = (entries) => h4("div", { className: "pw-update-list" }, entries.map((entry) => h4(
      "div",
      { key: entry.key, className: "pw-update" },
      entry.date && h4("span", { className: "pw-update-ts" }, entry.date),
      h4("span", { className: "pw-update-body" }, entry.text)
    )));
    const form = onAdd && h4(
      "form",
      { className: "pw-update-add", onSubmit: (event) => {
        event.preventDefault();
        add();
      } },
      h4("input", { className: "pw-input", autoFocus: userFacing, readOnly: busy, "aria-label": t("updatePlaceholder"), placeholder: t("updatePlaceholder"), value: text, onChange: (event) => setText(event.target.value) }),
      h4("button", { className: "pw-button", type: "submit", disabled: !text.trim() || busy }, t("addUpdate")),
      userFacing && h4("button", { className: "pw-button", type: "button", disabled: busy, onClick: cancel }, t("cancel"))
    );
    if (userFacing) {
      if (!records.length && !onAdd) return null;
      const latest = kind === "issue" && records.find((entry) => !entry.event);
      const earlier = records.filter((entry) => entry !== latest);
      return h4(
        "section",
        { className: "pw-updates", "aria-label": t("progressRecords") },
        latest && h4(ReadingText, { label: t("latestProgress"), value: latest.text }),
        earlier.length > 0 && h4(Disclosure, { label: t("progressRecords") }, list(earlier)),
        onAdd && (editing ? form : h4("button", { className: "pw-button", onClick: () => setEditing(true) }, t("recordProgress")))
      );
    }
    return h4(
      "section",
      { className: "pw-updates", "aria-label": t("updates") },
      showRecords && h4("strong", null, t("updates")),
      showRecords && (records.length ? list(records.slice(0, 3)) : h4("div", { className: "pw-empty" }, t("noActivity"))),
      records.length > 3 && h4(Disclosure, { label: t("olderProgress") }, list(records.slice(3))),
      records.some((entry) => entry.raw) && h4(
        Disclosure,
        { label: t("rawDetails") },
        h4(ReadText, { value: (activity ?? []).join("\n") })
      ),
      form
    );
  }
  function ProgressTimeline({ records, t, openWikiPage, onAdd, children }) {
    const [expanded, setExpanded] = useState2(() => /* @__PURE__ */ new Set());
    const [showOlder, setShowOlder] = useState2(false);
    if (!records.length && !onAdd) return null;
    const older = records.slice(3);
    const olderVisible = showOlder || older.some((entry) => expanded.has(entry.id));
    const rows = records.map((entry) => {
      const links = [];
      const detail = entry.detail.replace(/^(?:资料来源[:：]|Reference:)[ \t]*((?:wiki:|openwiki\/)[^\r\n]+)$/gm, (_line, path) => {
        links.push(path.trim());
        return "";
      });
      return h4(
        "details",
        {
          className: "pw-progress-item",
          key: entry.id,
          open: expanded.has(entry.id),
          onToggle: (event) => {
            const isOpen = event.currentTarget.open;
            setExpanded((current) => {
              if (current.has(entry.id) === isOpen) return current;
              const next = new Set(current);
              if (isOpen) next.add(entry.id);
              else next.delete(entry.id);
              return next;
            });
          }
        },
        h4(
          "summary",
          null,
          entry.date && h4("time", { dateTime: entry.at }, entry.date),
          h4("span", { className: "pw-preview" }, entry.summary)
        ),
        h4(
          "div",
          { className: "pw-progress-detail" },
          entry.date && h4("p", { className: "pw-note" }, t("progressRecordedAt"), " ", entry.date),
          h4(ReadingText, { value: detail }),
          links.length > 0 && h4(TaskReferences, { refs: [...new Set(links)], openWikiPage })
        )
      );
    });
    return h4(
      "section",
      { className: "pw-progress", "aria-label": t("progressRecords") },
      h4(
        "div",
        { className: "pw-progress-head" },
        h4("h3", null, t("progressRecords")),
        children?.type === "button" && children
      ),
      !records.length && h4("p", { className: "pw-note" }, t("noTaskProgress")),
      rows.slice(0, 3),
      older.length > 0 && h4("button", {
        className: "pw-button pw-quiet",
        "aria-expanded": olderVisible,
        onClick: () => {
          if (olderVisible) setExpanded((current) => new Set([...current].filter((id) => !older.some((entry) => entry.id === id))));
          setShowOlder(!olderVisible);
        }
      }, t(olderVisible ? "hideOldTaskProgress" : "oldTaskProgress")),
      olderVisible && rows.slice(3),
      children?.type !== "button" && children
    );
  }
  function ReadingText({ label, value, className }) {
    const blocks = readingBlocks(value);
    if (!blocks.length) return null;
    return h4(
      "div",
      { className: "pw-reading-block" + (className ? " " + className : "") },
      label && h4("h3", { className: "pw-reading-label" }, label),
      blocks.map(({ tag, lines }, index) => tag === "p" ? h4("p", { className: "pw-text", key: index }, lines.join("\n")) : h4(
        tag,
        { className: "pw-reading-list", key: index, ...tag === "ol" ? { start: lines[0].number } : {} },
        lines.map((line, item) => h4(
          "li",
          { key: item, ...tag === "ol" ? { value: line.number } : {} },
          tag === "ol" ? line.text : line
        ))
      ))
    );
  }
  function Verification({ verification, t }) {
    const { passed, failed, incomplete, unconfirmedChanges, hasManualEvidence } = verification;
    return h4(
      "div",
      { className: "pw-reading-verification" },
      h4("strong", null, t("verify")),
      failed > 0 && h4("p", { className: "pw-text pw-error" }, t("checksFailed").replace("{n}", String(failed))),
      incomplete > 0 && h4("p", { className: "pw-text pw-error" }, t("checksIncomplete")),
      unconfirmedChanges > 0 && h4("p", { className: "pw-text pw-error" }, t("unconfirmedChanges")),
      passed > 0 && h4("p", { className: "pw-text" }, t("checksPassed").replace("{n}", String(passed))),
      !passed && !failed && !incomplete && !hasManualEvidence && h4("p", { className: "pw-text" }, t("noChecks")),
      hasManualEvidence && h4("p", { className: "pw-text" }, t("manualEvidence"))
    );
  }
  function TaskResult({ task, t, children, since, userFacing = false, showAcceptance = true, showSummary = true }) {
    const result = taskResult(task, since);
    const reviewing = task.status === "in_review";
    if (userFacing) {
      const summary = result.recordedSummary;
      const earlier = (result.previousSummary || result.earlierSummary).replace(/\r?\n\r?\n\[AI 补充\] /g, "\n\n");
      return h4(
        "section",
        {
          className: "pw-reading pw-reading-result" + (showSummary ? "" : " pw-sidebar-review"),
          "aria-label": t(showSummary ? "demoResult" : "sidebarReviewDetails")
        },
        showSummary && h4(ReadingText, { label: t("demoResult"), value: summary || t("demoNoResult"), className: "pw-reading-lead" }),
        showAcceptance && h4(ReadingText, {
          label: t("requirementCriteria"),
          value: task.acceptance?.trim() || t("missingCriteria"),
          className: "pw-reading-criteria"
        }),
        h4(Verification, { verification: result.verification, t }),
        result.verification.hasManualEvidence && h4(ReadingText, { label: t("demoEvidence"), value: task.evidence }),
        task.hasObjective && !result.verification.hasManualEvidence && result.summary && h4("p", { className: "pw-note pw-evidence-note" }, t("useRecordedEvidence")),
        summary && !result.summary && h4("p", { className: "pw-note" }, t("resultUnverified")),
        h4(ReadingText, { label: t("demoLimits"), value: result.limits || t(result.unverifiedLimits ? "limitsUnverified" : "noLimits") }),
        earlier && !showSummary && h4("p", { className: "pw-note" }, t("previousResultUnverified")),
        earlier && showSummary && h4(
          Disclosure,
          { label: t("previousResultUnverified") },
          h4(ReadingText, { value: earlier }),
          result.unverifiedLimits && h4(ReadingText, { label: t("previousLimits"), value: result.unverifiedLimits })
        ),
        (!earlier || !showSummary) && result.unverifiedLimits && h4(
          Disclosure,
          { label: t("previousLimits") },
          h4(ReadingText, { value: result.unverifiedLimits })
        ),
        children
      );
    }
    const showResult = reviewing || !!result.summary;
    return h4(
      import_react4.default.Fragment,
      null,
      (showResult || result.verification.failed > 0 || result.verification.incomplete > 0 || result.verification.unconfirmedChanges > 0) && h4(
        "section",
        { className: "pw-result", "aria-label": t("demoResult") },
        showResult && h4(ReadText, { label: t(result.latestSupplement ? "latestSupplement" : "demoResult"), value: result.summary || t("demoNoResult") }),
        showResult && h4(ReadText, { label: t("acceptanceField"), value: task.acceptance }),
        h4(Verification, { verification: result.verification, t }),
        showResult && h4(ReadText, { label: t("demoLimits"), value: result.limits || t(result.unverifiedLimits ? "limitsUnverified" : "noLimits") }),
        children
      ),
      (task.evidence || task.objective || result.previousSummary || result.fullSummary !== result.summary || result.fullLimits !== result.limits || !showResult && result.fullLimits) && h4(
        Disclosure,
        { label: t("verifyRecords") },
        result.latestSupplement ? h4(
          import_react4.default.Fragment,
          null,
          h4(ReadText, { label: t("previousResult"), value: result.earlierSummary }),
          h4(ReadText, { label: t("latestSupplement"), value: result.latestSupplement }),
          h4(ReadText, { label: t("fullResult"), value: result.fullSummary })
        ) : h4(ReadText, { label: t(result.previousSummary ? "previousResult" : "demoResult"), value: result.fullSummary }),
        h4(ReadText, { label: t(result.unverifiedLimits ? "previousLimits" : "demoLimits"), value: result.fullLimits }),
        h4(ReadText, { label: t("demoEvidence"), value: task.evidence }),
        h4(ReadText, { value: task.objective })
      )
    );
  }
  function TaskReferences({ refs, openWikiPage }) {
    return h4("div", null, refs.map((ref) => {
      const wiki = /^(?:openwiki\/|wiki:)/.test(ref);
      return wiki && openWikiPage ? h4("button", { key: ref, className: "pw-button", onClick: () => openWikiPage(ref.replace(/^(?:openwiki\/|wiki:)/, "")) }, ref) : h4("span", { key: ref, className: "pw-refchip" }, ref);
    }));
  }
  function TaskReading({ task, requirement, t, openWikiPage, onAdd, sidebar = false, resultActions, children, since }) {
    const overview = taskOverview(task);
    const description = task.description?.trim();
    const supplementary = description !== overview ? description : "";
    const resultFirst = ["in_review", "done"].includes(task.status);
    const result = taskResult(task, since);
    const hasResult = result.fullSummary || result.fullLimits || result.verification.failed || result.verification.incomplete || result.verification.unconfirmedChanges;
    if (sidebar) {
      const scope = requirement?.scope?.trim();
      const exclusions = requirement?.q_out?.trim();
      return h4(
        "div",
        { className: "pw-reading" },
        task.status === "blocked" && h4(ReadingText, {
          label: t("blockedReason"),
          value: task.blocked_reason?.trim() || t("taskNoReason"),
          className: "pw-reading-reason pw-reading-warning"
        }),
        task.status === "cancelled" && h4(ReadingText, {
          label: t("taskCancelReason"),
          value: cancellationReason(task) || t("taskNoReason"),
          className: "pw-reading-reason"
        }),
        h4(ReadingText, { label: t("sidebarTaskDescription"), value: overview || t("taskMissing"), className: "pw-reading-lead" }),
        h4(ReadingText, {
          label: t("sidebarFinding"),
          value: task.rootCause?.trim() || t("sidebarNotRecorded"),
          className: task.rootCause?.trim() ? void 0 : "pw-sidebar-empty-field"
        }),
        h4(ReadingText, { label: t("taskSteps"), value: task.triggerPath }),
        requirement && h4(
          "section",
          { className: "pw-reading-block pw-reading-divider" },
          h4("h3", { className: "pw-reading-label" }, t("sidebarRequirementScope")),
          h4(ReadingText, { value: scope || !exclusions && t("sidebarNotRecorded") }),
          h4(ReadingText, { label: t("q_out"), value: exclusions })
        ),
        !resultFirst && h4(ReadingText, { label: t("requirementCriteria"), value: task.acceptance, className: "pw-reading-criteria" }),
        resultFirst && h4(TaskResult, { task, t, since, userFacing: true, showSummary: false }, resultActions),
        !resultFirst && task.status !== "cancelled" && !!hasResult && h4(TaskResult, { task, t, since, userFacing: true, showAcceptance: false, showSummary: false }),
        children,
        (supplementary || task.refs?.length > 0) && h4(
          Disclosure,
          { label: t("taskAdditional") },
          h4(ReadingText, { label: t("taskSupplement"), value: supplementary }),
          task.refs?.length > 0 && h4(TaskReferences, { refs: task.refs, openWikiPage })
        )
      );
    }
    const progress = h4(UpdateLog, {
      activity: task.activity,
      t,
      onAdd: ["done", "cancelled"].includes(task.status) ? null : onAdd,
      userFacing: true,
      timeline: sidebar,
      openWikiPage
    });
    return h4(
      "div",
      { className: "pw-reading" },
      task.status === "blocked" && h4(ReadingText, {
        label: t("blockedReason"),
        value: task.blocked_reason?.trim() || t("taskNoReason"),
        className: "pw-reading-reason pw-reading-warning"
      }),
      task.status === "cancelled" && h4(ReadingText, {
        label: t("taskCancelReason"),
        value: cancellationReason(task) || t("taskNoReason"),
        className: "pw-reading-reason"
      }),
      resultFirst && h4(TaskResult, { task, t, since, userFacing: true }, resultActions),
      h4(ReadingText, { label: t("taskWhat"), value: overview || t("taskMissing"), className: "pw-reading-lead" }),
      !sidebar && h4(ReadingText, { label: t("taskSteps"), value: task.triggerPath, className: "pw-reading-divider" }),
      !resultFirst && h4(ReadingText, { label: t("requirementCriteria"), value: task.acceptance, className: "pw-reading-criteria" }),
      !resultFirst && task.status !== "cancelled" && !!hasResult && h4(TaskResult, { task, t, since, userFacing: true, showAcceptance: false }),
      children,
      sidebar && progress,
      (supplementary || sidebar && task.triggerPath?.trim() || task.rootCause?.trim() || task.refs?.length > 0) && h4(
        Disclosure,
        { label: t("taskAdditional") },
        sidebar && h4(ReadingText, { label: t("taskSteps"), value: task.triggerPath }),
        h4(ReadingText, { label: t("taskSupplement"), value: supplementary }),
        h4(ReadingText, { label: t("taskCause"), value: task.rootCause }),
        task.refs?.length > 0 && h4(TaskReferences, { refs: task.refs, openWikiPage })
      ),
      !sidebar && progress
    );
  }
  function DraftSuggestions({ proposals, act, root, t, busy, dismissMethod = "sync/dismiss", showHeading = true, rememberEdits, adoptDisabled = false }) {
    const [edits, setEdits] = useState2(() => ({ ...rememberEdits }));
    if (!proposals.length) return null;
    return h4(
      "section",
      { className: "pw-result", "aria-label": t("demoDrafts") },
      showHeading && h4("strong", null, t("demoDrafts")),
      proposals.map((proposal) => {
        const patch = proposal.suggested_patch ?? {};
        const creating = proposal.kind === "new_task";
        const values = edits[proposal.id] ?? (creating ? issueDraftFrom(patch) : patch);
        const fields = Object.entries(values).filter(([key]) => key !== "action");
        const change = (key, value) => {
          const next = { ...values, [key]: value };
          if (rememberEdits) rememberEdits[proposal.id] = next;
          setEdits((previous) => ({ ...previous, [proposal.id]: next }));
        };
        const missing = creating && taskFormError(values);
        const canAdopt = creating ? !missing : fields.length && fields.every(([, value]) => String(value).trim());
        const revised = creating ? taskContentPatch(values, patch) : edits[proposal.id];
        return h4(
          "div",
          { key: proposal.id, className: "pw-disclosure" },
          creating && h4("strong", null, t("newTask")),
          h4(ReadText, { value: proposal.reason }),
          proposal.split && h4(ReadText, { label: t("splitBasis"), value: proposal.split.requirements?.map((item) => item.text).join("\n") }),
          creating ? h4(TaskFields, { form: { draft: values, change }, t, busy, focus: null }) : fields.map(([key, value]) => h4(
            "label",
            { key, className: "pw-field" },
            h4("span", { className: "pw-label" }, draftFieldLabel(key, t)),
            h4("textarea", { className: "pw-textarea", rows: 2, value, onChange: (event) => change(key, event.target.value) })
          )),
          creating && h4(ErrorDetails, { error: missing, t, showRaw: false }),
          h4(
            "div",
            { className: "pw-actions" },
            h4("button", { className: "pw-button", disabled: busy || adoptDisabled || !canAdopt, onClick: () => act("proposal/adopt", { root, proposalId: proposal.id, patch: revised }) }, t(proposal.split ? "splitAdopt" : "demoAdopt")),
            h4("button", { className: "pw-button", disabled: busy, onClick: () => act(dismissMethod, { root, proposalId: proposal.id }) }, t("demoDismiss"))
          )
        );
      })
    );
  }

  // client-src/detail/requirement-content.js
  var import_react5 = __toESM(__require("react"), 1);
  var h5 = import_react5.default.createElement;
  var { useState: useState3 } = import_react5.default;
  function RequirementOverview({ req, t }) {
    const overview = requirementOverview(req);
    const goal = req.goal?.trim();
    const scope = req.scope?.trim();
    const exclusions = req.q_out?.trim();
    const acceptance = req.acceptance?.trim();
    const legacyCriteria = req.q_success?.trim();
    const criteria = [...new Set([acceptance, legacyCriteria].filter(Boolean))].join("\n\n");
    const missing = [
      !req.title?.trim() && "issueTitle",
      !overview && "requirementOverview"
    ].filter(Boolean);
    const tasks = req.issues ?? [];
    const done = tasks.filter((task) => task.status === "done").length;
    const cancelled = tasks.filter((task) => task.status === "cancelled").length;
    return h5(
      "div",
      { className: "pw-reading" },
      h5(ReadingText, { label: t("requirementOverview"), value: overview, className: "pw-reading-lead" }),
      goal !== overview && h5(ReadingText, { label: t("goal"), value: goal, className: "pw-reading-divider" }),
      (scope || exclusions) && h5(
        "section",
        { className: "pw-reading-block pw-reading-divider" },
        h5("h3", { className: "pw-reading-label" }, t("requirementScope")),
        h5(ReadingText, { value: scope }),
        h5(ReadText, { label: t("q_out"), value: exclusions })
      ),
      req.status === "backlog" && missing.length > 0 && h5("p", { className: "pw-note" }, t("requirementMissing").replace("{fields}", missing.map(t).join(t("fieldSeparator")))),
      ["pending", "completed"].includes(req.status) && h5(DeliveryResult, { req, t, userFacing: true, showAcceptance: false }),
      (req.q_who?.trim() || criteria || req.background?.trim() || req.decisionNotes?.trim()) && h5(
        Disclosure,
        { label: t("requirementExtra") },
        h5(ReadingText, { label: t("q_who"), value: req.q_who }),
        h5(ReadingText, { label: t("requirementCriteria"), value: criteria, className: "pw-reading-criteria" }),
        h5(ReadingText, { label: t("requirementBackground"), value: req.background }),
        h5(ReadingText, { label: t("decisionNotes"), value: req.decisionNotes })
      ),
      tasks.length > 0 && h5(
        "footer",
        { className: "pw-reading-footer" },
        t("taskCount").replace("{total}", String(tasks.length)).replace("{done}", String(done)),
        cancelled > 0 && " \xB7 " + t("cancelledCount").replace("{n}", String(cancelled))
      )
    );
  }
  function RequirementHistory({ req, t, onAdd }) {
    const reviews = reviewRecords(req.reviews);
    return h5(
      import_react5.default.Fragment,
      null,
      reviews.length > 0 && h5(
        Disclosure,
        { label: t("reviewRecords") },
        reviews.map((review, index) => h5(
          "div",
          { className: "pw-reading-block", key: review.marker || review.round || index },
          h5("strong", null, t(review.kind === "review" ? review.decision === "approved" ? "reviewApproved" : "reviewReturned" : review.decision === "approved" ? "deliveryAccepted" : "deliveryReturned")),
          review.at && h5("span", { className: "pw-count" }, " \xB7 " + String(review.at).replace("T", " ").slice(0, 16)),
          h5(ReadingText, { label: t("reviewOpinion"), value: review.opinion }),
          h5(ReadingText, { label: t("demoDeliverySummary"), value: review.summary })
        ))
      ),
      h5(UpdateLog, { activity: req.activity, onAdd: !["pending", "completed"].includes(req.status) ? onAdd : null, t, kind: "requirement", userFacing: true, reviews })
    );
  }
  function DeliveryResult({ req, t, compact = false, userFacing = false, showAcceptance = true }) {
    const result = requirementResult(req);
    const tasks = req.issues ?? [];
    const relevant = req.status === "pending" || req.status === "completed";
    const hasCancelled = tasks.some((issue) => issue.status === "cancelled") || !!req.hasCancelled;
    const currentImpact = hasCancelled ? result.cancelImpact : "";
    if (userFacing && relevant) {
      return h5(
        "section",
        { className: "pw-reading pw-reading-delivery", "aria-label": t("demoDeliverySummary") },
        h5(ReadingText, { label: t("demoDeliverySummary"), value: result.summary || t("missingDeliverySummary") }),
        showAcceptance && h5(ReadingText, { label: t("requirementCriteria"), value: req.acceptance?.trim() || req.q_success?.trim() || t("missingCriteria") }),
        hasCancelled && h5(ReadingText, { label: t("demoCancelImpact"), value: currentImpact || t("missingCancelImpact") }),
        tasks.length > 0 && h5(
          "section",
          { className: "pw-reading-block" },
          h5("h3", { className: "pw-reading-label" }, t("deliveredTaskResults")),
          tasks.map((task) => h5(
            "div",
            { key: task.id, className: "pw-result" },
            h5("strong", null, task.title),
            " \xB7 ",
            t("st_" + task.status),
            task.status === "cancelled" ? h5(ReadingText, { label: t("taskCancelReason"), value: cancellationReason(task) || t("taskNoReason") }) : h5(TaskResult, { task, t, since: req.deliveryStartedAt, userFacing: true, showAcceptance: false })
          ))
        ),
        (result.previousSummary || result.previousCancelImpact) && h5(
          Disclosure,
          { label: t("previousResult") },
          h5(ReadingText, { value: result.previousSummary }),
          h5(ReadingText, { label: t("demoCancelImpact"), value: result.previousCancelImpact })
        )
      );
    }
    if (!result.summary && !result.previousSummary && !result.cancelImpact && !result.previousCancelImpact && req.status !== "pending") return null;
    if (compact) return h5(
      "section",
      { className: "pw-result", "aria-label": t("demoPendingAcceptance") },
      h5("strong", null, t("demoPendingAcceptance")),
      h5(ReadText, { value: result.summary.split(/\r?\n/)[0] }),
      h5(ReadText, { label: t("demoCancelImpact"), value: currentImpact })
    );
    return h5(
      "section",
      { className: "pw-result", "aria-label": t("demoDeliverySummary") },
      h5(ReadText, { label: t("demoDeliverySummary"), value: result.summary }),
      relevant && h5(ReadText, { label: t("acceptanceField"), value: req.acceptance || req.q_success }),
      relevant && h5(ReadText, { label: t("demoCancelImpact"), value: currentImpact }),
      relevant && tasks.map((task) => {
        const item = taskResult(task, Math.max(req.deliveryStartedAt || 0, task.deliveryStartedAt || 0));
        const cancelled = task.status === "cancelled";
        return h5(
          "div",
          { key: task.id, className: "pw-result" },
          h5("strong", null, task.title),
          " \xB7 ",
          t("st_" + task.status),
          cancelled ? null : h5(
            import_react5.default.Fragment,
            null,
            h5(ReadText, { value: item.summary }),
            h5(Verification, { verification: item.verification, t }),
            h5(ReadText, { label: t("demoLimits"), value: item.limits })
          ),
          (item.fullSummary !== item.summary || item.fullLimits !== item.limits || task.evidence || task.objective || cancelled) && h5(
            Disclosure,
            { label: t(cancelled ? "history" : "verifyRecords") },
            cancelled ? h5(ReadText, { value: (task.activity ?? []).map((line) => activityEntry(line, t, "issue").text).join("\n") }) : h5(
              import_react5.default.Fragment,
              null,
              h5(ReadText, { label: t(item.previousSummary ? "previousResult" : "demoResult"), value: item.fullSummary }),
              h5(ReadText, { value: task.evidence }),
              h5(ReadText, { value: task.objective })
            )
          )
        );
      }),
      (result.previousSummary || result.previousCancelImpact) && h5(
        Disclosure,
        { label: t("previousResult") },
        h5(ReadText, { value: result.previousSummary }),
        h5(ReadText, { label: t("demoCancelImpact"), value: result.previousCancelImpact })
      )
    );
  }
  function ManualDelivery({ req, t, act, root, busy, userFacing = false, onSuccess, onDraftChange, draftMemory, draftKey }) {
    const [reviewReq, setReviewReq] = useState3(() => draftMemory?.[draftKey]?.reviewReq ?? req);
    const [summary, setSummary] = useState3(() => draftMemory?.[draftKey]?.summary ?? "");
    const [impact, setImpact] = useState3(() => draftMemory?.[draftKey]?.impact ?? "");
    const [submitting, setSubmitting] = useState3(false);
    const [error, setError] = useState3(null);
    const waiting = busy || submitting;
    const currentReq = req.status !== "in_progress" ? req : reviewReq;
    const statusChanged = currentReq.status !== "in_progress";
    const tasks = reviewReq.issues ?? [];
    const remember = (nextSummary, nextImpact, reviewed = reviewReq) => {
      if (!draftMemory || !draftKey) return;
      if (nextSummary || nextImpact) draftMemory[draftKey] = { summary: nextSummary, impact: nextImpact, reviewReq: reviewed };
      else delete draftMemory[draftKey];
    };
    return h5(
      "form",
      { className: "pw-result", onSubmit: async (event) => {
        event.preventDefault();
        if (waiting || statusChanged || !summary.trim()) return;
        setSubmitting(true);
        setError(null);
        try {
          const res = await act("requirement/submit", { root, id: reviewReq.id, summary: summary.trim(), cancelImpact: impact.trim(), expectFingerprint: await deliveryFingerprint(reviewReq) });
          if (res?.ok) {
            setSummary("");
            setImpact("");
            remember("", "");
            onDraftChange?.(false);
            onSuccess?.();
          } else {
            let displayError = res;
            if (res?.code === "ROUND_CHANGED" || res?.code === "CONFLICT") {
              const latest = await rpc("requirement/get", { root, id: reviewReq.id });
              if (latest.ok) {
                setReviewReq(latest.data);
                remember(summary, impact, latest.data);
                displayError = { ...res, code: latest.data.status === "in_progress" ? "REVIEW_CONTENT_UPDATED" : "DELIVERY_STATUS_CHANGED" };
              }
            }
            if (userFacing) setError(workbenchError(displayError, t).text);
          }
        } finally {
          setSubmitting(false);
        }
      } },
      statusChanged && h5(DeliveryResult, { req: currentReq, t, userFacing: true }),
      statusChanged && !error && h5("p", { className: "pw-error", role: "alert" }, t("errDeliveryStatusChanged")),
      !statusChanged && !error && (tasks.length === 0 || tasks.some((task) => task.status !== "done")) && h5("p", { className: "pw-error", role: "alert" }, t(tasks.length === 0 ? "errNoTasks" : "errTasksNotAccepted")),
      h5(ReadingText, { label: t("requirementCriteria"), value: reviewReq.acceptance?.trim() || reviewReq.q_success?.trim() || t("missingCriteria") }),
      tasks.map((task) => h5(
        "div",
        { key: task.id, className: "pw-result" },
        h5("strong", null, task.title),
        " \xB7 ",
        t("st_" + task.status),
        task.status === "cancelled" ? h5(ReadingText, { label: t("taskCancelReason"), value: cancellationReason(task) || t("taskNoReason") }) : h5(TaskResult, { task, t, since: reviewReq.deliveryStartedAt, userFacing: true, showAcceptance: false })
      )),
      h5(
        "label",
        { className: "pw-field" },
        t("demoDeliverySummary"),
        h5("textarea", { className: "pw-textarea", rows: 3, readOnly: waiting, value: summary, onChange: (event) => {
          const value = event.target.value;
          setSummary(value);
          remember(value, impact);
          onDraftChange?.(!!value || !!impact);
        } })
      ),
      impact && h5(
        "label",
        { className: "pw-field" },
        t("demoCancelImpact"),
        h5("textarea", { className: "pw-textarea", rows: 2, readOnly: waiting, value: impact, onChange: (event) => {
          const value = event.target.value;
          setImpact(value);
          remember(summary, value);
          onDraftChange?.(!!summary || !!value);
        } })
      ),
      error && h5("p", { className: "pw-error", role: "alert" }, error),
      h5("button", { type: "submit", className: "pw-button primary", disabled: waiting || statusChanged || !summary.trim() }, t("demoSubmitAcceptance"))
    );
  }

  // client-src/shared/modals.js
  var h6 = import_react6.default.createElement;
  var { useEffect: useEffect3, useState: useState4 } = import_react6.default;
  function ReasonModal({ modal, t, setModal, mutate, root, trashWithUndo, reopenState, requirements, newDraft, changeNewDraft, createReq, clearNewDraft }) {
    const [value, setValue] = useState4("");
    const [checked, setChecked] = useState4([]);
    const [newTask, setNewTask] = useState4(issueDraftFrom);
    const [addingTask, setAddingTask] = useState4(false);
    const [reviewIssue, setReviewIssue] = useState4(modal.issue);
    const [reviewReq, setReviewReq] = useState4(modal.req);
    const [busy, setBusy] = useState4(false);
    const [error, setError] = useState4(null);
    const [deliveryFailed, setDeliveryFailed] = useState4(false);
    useEffect3(() => {
      if (modal.kind !== "submitDelivery") return;
      let active = true;
      rpc("delivery/status", { root, reqId: modal.req.id }).then((res) => {
        if (active && res.ok) setDeliveryFailed(res.data.job?.status === "failed");
      });
      return () => {
        active = false;
      };
    }, [modal, root]);
    const close = () => setModal((current) => current === modal ? null : current);
    const liveReq = modal.req && requirements ? requirements.find((r) => r.id === modal.req.id) ?? modal.req : modal.req;
    const cancel = () => {
      if (!busy) close();
    };
    const run = async (action) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      const res = await action();
      if (res.ok) close();
      else {
        setError(res);
        setBusy(false);
      }
    };
    const errorView = h6(ErrorDetails, { error, t, showRaw: false });
    const taskForm = { draft: newTask, change: (name, value2) => {
      setError(null);
      setNewTask((draft) => ({ ...draft, [name]: value2 }));
    } };
    if (modal.kind === "createRequirement") {
      const formId = "pw-create-requirement";
      const form = { draft: newDraft, change: (name, value2) => {
        setError(null);
        changeNewDraft(name, value2);
      } };
      return h6(Modal, { title: t("newRequirement"), onClose: cancel, wide: true, actions: [
        h6("button", {
          type: "button",
          className: "pw-button",
          disabled: busy,
          onClick: () => {
            clearNewDraft();
            cancel();
          }
        }, t("cancel")),
        h6("button", { type: "submit", form: formId, className: "pw-button primary", disabled: busy }, t("save"))
      ] }, h6(
        "form",
        { id: formId, noValidate: true, onSubmit: (e) => {
          e.preventDefault();
          run(createReq);
        } },
        h6(RequirementFields, { form, t, busy, autoFocus: true }),
        errorView
      ));
    }
    if (modal.kind === "createTask") {
      const create = async () => {
        const invalid = taskFormError(newTask);
        if (invalid) return invalid;
        const result = await mutate("issue/create", { root, reqId: modal.req.id, ...newTaskInput(newTask) }, { inlineError: true });
        if (result.ok) modal.onCreated(result.data.id);
        return result;
      };
      return h6(
        Modal,
        { title: t("newTask"), onClose: cancel, wide: true, actions: [] },
        h6("p", { className: "pw-note" }, modal.req.title),
        h6(TaskForm, { form: taskForm, t, busy, error, onSave: () => run(create), onCancel: cancel })
      );
    }
    if (modal.kind === "moveError") {
      return h6(Modal, { title: t("moveRejectedTitle"), onClose: close, actions: [
        h6("button", { className: "pw-button primary", onClick: close }, t("ok"))
      ] }, h6(ErrorDetails, { error: modal.error ?? { message: modal.message }, t, showRaw: false }));
    }
    if (modal.kind === "reason") {
      const submit = () => {
        if (value.trim()) return run(() => modal.onOk(value.trim()));
      };
      return h6(
        Modal,
        { title: modal.title ?? t("reasonTitle"), onClose: cancel, actions: [
          h6("button", { className: "pw-button", disabled: busy, onClick: cancel }, t("cancel")),
          h6("button", { className: "pw-button primary", disabled: busy || !value.trim(), onClick: submit }, t("ok"))
        ] },
        modal.body && h6("p", null, modal.body),
        h6("input", {
          className: "pw-input",
          autoFocus: true,
          readOnly: busy,
          "aria-label": t("reasonTitle"),
          placeholder: t("reasonPlaceholder"),
          value,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }
        }),
        errorView
      );
    }
    if (modal.kind === "submitDelivery") {
      const submit = async (method, input) => {
        setBusy(true);
        const res = await mutate(method, input, { inlineError: true });
        if (!res.ok) setBusy(false);
        return res;
      };
      return h6(
        Modal,
        { title: t("submit"), onClose: cancel, wide: true, actions: [
          h6("button", { className: "pw-button", disabled: busy, onClick: cancel }, t("cancel"))
        ] },
        h6("p", null, liveReq.title),
        deliveryFailed && h6("p", { className: "pw-error" }, t("demoDeliveryFailed")),
        h6(ManualDelivery, { req: liveReq, t, act: submit, root, busy, userFacing: true, onSuccess: close })
      );
    }
    if (modal.kind === "confirmComplete" || modal.kind === "confirmIssue") {
      const issue = reviewIssue;
      const confirm = async () => {
        const res = await mutate("issue/confirm", { root, reqId: modal.reqId, id: issue.id, fileHash: issue.hash }, { inlineError: true });
        if (res.code !== "CONFLICT") return res;
        const latest = await rpc("requirement/get", { root, id: modal.reqId });
        if (!latest.ok) return latest;
        const current = latest.data.issues.find((task) => task.id === issue.id);
        if (!current) return { ok: false, code: "NOT_FOUND" };
        setReviewIssue(current);
        setReviewReq(latest.data);
        return res;
      };
      const confirmRequirement = async () => {
        const res = await modal.onOk(reviewReq);
        if (res.code !== "CONFLICT" && res.code !== "ROUND_CHANGED") return res;
        const latest = await rpc("requirement/get", { root, id: reviewReq.id });
        if (latest.ok) {
          setReviewReq(latest.data);
          return { ...res, code: "REVIEW_CONTENT_UPDATED" };
        }
        return res;
      };
      return h6(
        Modal,
        { title: t(issue ? "confirmIssueTitle" : "confirmCompleteTitle"), onClose: cancel, wide: true, actions: [
          h6("button", { className: "pw-button", disabled: busy, onClick: cancel }, t("cancel")),
          h6("button", {
            className: "pw-button primary",
            disabled: busy || issue && (issue.status !== "in_review" || !taskResult(issue, reviewReq?.deliveryStartedAt).summary),
            onClick: () => run(issue ? confirm : confirmRequirement)
          }, t(issue ? "demoConfirm" : "acceptRequirement"))
        ] },
        h6("p", null, issue?.title ?? reviewReq.title),
        issue ? h6(TaskResult, { task: issue, since: reviewReq?.deliveryStartedAt, t, userFacing: true }) : h6(DeliveryResult, { req: reviewReq, t, userFacing: true }),
        errorView
      );
    }
    if (modal.kind === "reopenRequirement") {
      const req = liveReq;
      const retry = reopenState || req.pendingReopen;
      const submit = () => run(() => {
        const invalid = !retry && addingTask && taskFormError(newTask);
        if (invalid) return invalid;
        return mutate("requirement/reopen", retry ? { root, id: req.id } : {
          root,
          id: req.id,
          reason: value.trim(),
          reopen: checked,
          create: addingTask ? [newTaskInput(newTask)] : [],
          fileHash: req.hash
        }, { inlineError: true });
      });
      return h6(
        Modal,
        { title: t(retry ? "resumeReopen" : req.status === "completed" ? "reopen" : "sendBack"), onClose: cancel, actions: [
          h6("button", { className: "pw-button", disabled: busy, onClick: close }, t("cancel")),
          h6("button", { className: "pw-button primary", disabled: busy || !retry && (!value.trim() || !checked.length && !addingTask), onClick: submit }, t(retry ? "retry" : req.status === "completed" ? "reopen" : "sendBack"))
        ] },
        h6("p", null, req.title),
        retry && h6("p", null, t("reopenProgress").replace("{done}", String(retry.items.filter((item) => item.done).length)).replace("{total}", String(retry.items.length))),
        !retry && h6(
          import_react6.default.Fragment,
          null,
          h6("textarea", { className: "pw-textarea", "aria-label": t("askFix"), placeholder: t("askFix"), value, readOnly: busy, onChange: (e) => setValue(e.target.value) }),
          h6("p", null, t("pickReopen")),
          (req.issues ?? []).filter((i) => ["done", "cancelled"].includes(i.status)).map((i) => h6("label", { key: i.id }, h6("input", { type: "checkbox", disabled: busy, checked: checked.includes(i.id), onChange: (e) => {
            const selected = e.target.checked;
            setChecked((prev) => selected ? [...prev, i.id] : prev.filter((id) => id !== i.id));
          } }), i.title)),
          h6("label", { className: "pw-field" }, h6("input", {
            type: "checkbox",
            checked: addingTask,
            disabled: busy,
            onChange: (event) => {
              setError(null);
              setAddingTask(event.target.checked);
            }
          }), " ", t("newTask")),
          addingTask && h6(TaskFields, { form: taskForm, t, busy })
        ),
        errorView
      );
    }
    if (modal.kind === "delete") {
      const n = (modal.req.issues ?? []).length;
      return h6(Modal, { title: t("deleteTitle"), onClose: close, actions: [
        h6("button", { className: "pw-button", onClick: close }, t("cancel")),
        h6("button", { className: "pw-button danger", onClick: () => {
          setModal(null);
          trashWithUndo("requirement", modal.req.id, void 0, modal.req.title);
        } }, t("delete"))
      ] }, h6("p", null, t("deleteBody").replace("{title}", modal.req.title).replace("{n}", String(n))));
    }
    return null;
  }

  // client-src/shell/nav-state.js
  var PAGES = ["home", "pool", "review", "ready", "dev", "blocked", "board", "pending", "records", "wiki", "arch", "sync"];
  var MENU = [
    { page: "home", label: "navHome" },
    { group: "navRequirements", items: [{ page: "pool", label: "navPool" }, { page: "review", label: "navReview" }, { page: "ready", label: "navReady" }] },
    { group: "navDevelopment", items: [{ page: "dev", label: "navDev" }, { page: "blocked", label: "navBlocked" }, { page: "board", label: "navBoard" }] },
    { group: "navAcceptance", items: [{ page: "pending", label: "navPending" }, { page: "records", label: "navRecords" }] },
    { group: "navResources", items: [{ page: "wiki", label: "navWiki" }, { page: "arch", label: "navArch" }] }
  ];
  var statusPage = (status) => ({ backlog: "pool", reviewing: "review", ready: "ready", in_progress: "dev", pending: "pending", completed: "board" })[status] ?? "board";
  var COLS = ["backlog", "reviewing", "ready", "in_progress", "pending", "completed"];
  var MOVES = {
    backlog: { reviewing: "move" },
    reviewing: { ready: "move", backlog: "reason" },
    ready: { in_progress: "move" },
    in_progress: { pending: "submitDelivery" },
    pending: { completed: "confirmComplete", in_progress: "reopenRequirement" },
    completed: { in_progress: "reopenRequirement" }
  };
  var ISSUE_MOVES = {
    todo: { blocked: "block", cancelled: "cancelTask" },
    doing: { blocked: "block", todo: "returnTodo", cancelled: "cancelTask" },
    blocked: { todo: "returnTodo", cancelled: "cancelTask" },
    in_review: { done: "demoConfirm", todo: "returnTodo", cancelled: "cancelTask" },
    done: { todo: "reopen" },
    cancelled: { todo: "restoreTask" }
  };
  var defaultViewState = () => ({ page: "home", params: null, filters: {}, history: [] });
  function normalizeViewState(raw) {
    if (!raw || typeof raw !== "object") return defaultViewState();
    return {
      page: PAGES.includes(raw.page) ? raw.page : "home",
      params: raw.params && typeof raw.params === "object" ? raw.params : null,
      filters: raw.filters && typeof raw.filters === "object" ? raw.filters : {},
      history: Array.isArray(raw.history) ? raw.history : []
    };
  }
  var filterOf = (view, page) => view.filters[page] ?? {};
  var withFilter = (view, page, patch) => ({ ...view, filters: { ...view.filters, [page]: { ...filterOf(view, page), ...patch } } });
  function openDetail(view, params, page = view.page) {
    const history = view.params ? [...view.history, { page: view.page, params: view.params }] : page !== view.page ? [...view.history, { page: view.page, params: null }] : view.history;
    return { ...view, page, params, history };
  }
  function backOf(view) {
    if (view.history.length) {
      const prev = view.history[view.history.length - 1];
      return { ...view, page: prev.page, params: prev.params, history: view.history.slice(0, -1) };
    }
    return { ...view, params: null };
  }
  var orderOf = (item) => typeof item.order === "number" && Number.isFinite(item.order) ? item.order : Number.MAX_SAFE_INTEGER;
  var byOrder = (a, b) => orderOf(a) - orderOf(b) || String(a.created ?? "").localeCompare(String(b.created ?? "")) || String(a.id).localeCompare(String(b.id));
  var sortedTasks = (issues) => [...issues ?? []].sort(byOrder);
  var homeSummaryIncomplete = (home, error = null) => !!error || (home?.diagnostics ?? []).some((d) => ["READ_FAILED", "MISSING_FRONTMATTER", "INVALID_STATUS", "SCHEMA_TOO_NEW", "MISSING_FIELD", "DUPLICATE_ID"].includes(d.code));
  function awaitingAuthSessions(facts, sessionStatus) {
    const waiting = /* @__PURE__ */ new Map();
    for (const fact of facts ?? []) {
      if (!fact.issueId || waiting.has(fact.issueId)) continue;
      const linked = Array.isArray(fact.sessionIds) ? fact.sessionIds : [fact.sessionId].filter(Boolean);
      const candidates = fact.sessionId && linked.includes(fact.sessionId) ? [fact.sessionId, ...linked.filter((id) => id !== fact.sessionId)] : linked;
      const sessionId = candidates.find((id) => sessionStatus?.get(id)?.pendingInteraction?.kind === "approval");
      if (sessionId) waiting.set(fact.issueId, sessionId);
    }
    return waiting;
  }
  function snapshotAuthStatus(sessionStatus) {
    const result = /* @__PURE__ */ new Map();
    for (const [id, status] of sessionStatus ?? []) {
      const p = status?.pendingInteraction;
      if (p?.kind === "approval") result.set(id, { pendingInteraction: {
        kind: p.kind,
        sessionId: p.sessionId,
        key: p.key,
        callId: p.callId,
        toolName: p.toolName
      } });
    }
    return result;
  }
  function homeDuringAuthRefresh(home, stale) {
    return !home || !stale ? home : {
      ...home,
      authRefreshing: true,
      reminders: (home.reminders ?? []).filter((item) => item.kind !== "awaitingAuth" && !item.kinds?.includes("awaitingAuth"))
    };
  }
  function awaitingAuthDetails(facts, sessionStatus) {
    const selected = awaitingAuthSessions(facts, sessionStatus);
    const details = /* @__PURE__ */ new Map();
    for (const fact of facts ?? []) {
      if (!selected.has(fact.issueId) || details.has(fact.issueId)) continue;
      const ids = [...new Set(Array.isArray(fact.sessionIds) ? fact.sessionIds : [fact.sessionId].filter(Boolean))];
      const pending = ids.map((id) => [id, sessionStatus?.get(id)?.pendingInteraction]).filter(([, item]) => item?.kind === "approval");
      const matched = pending.map(([sessionId, item]) => {
        if (item.sessionId !== sessionId || typeof item.key !== "string" || !item.key || typeof item.callId !== "string" || !item.callId || typeof item.toolName !== "string" || !item.toolName) return null;
        const candidates = (fact.approvalRequests ?? []).filter((a) => a.sessionId === sessionId && a.callId === item.callId && a.toolName === item.toolName && typeof a.approvalId === "string" && a.approvalId && Number.isFinite(a.askedAt) && a.askedAt > 0 && a.askedAt <= Date.now());
        return candidates.length === 1 ? candidates[0] : null;
      });
      const known = pending.length > 0 && matched.every(Boolean);
      const askedAt = known ? Math.min(...matched.map((a) => a.askedAt)) : null;
      details.set(fact.issueId, {
        sessionId: known ? pending[matched.findIndex((a) => a.askedAt === askedAt)][0] : selected.get(fact.issueId),
        askedAt,
        identity: JSON.stringify(pending.map(([id, item], index) => [
          id,
          item?.key ?? null,
          item?.callId ?? null,
          item?.toolName ?? null,
          matched[index]?.approvalId ?? null,
          matched[index]?.askedAt ?? null
        ]))
      });
    }
    return details;
  }
  var byUpdatedDesc = (a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? ""));
  var titleMatch = (item, query) => !String(query ?? "").trim() || String(item.title ?? "").toLowerCase().includes(String(query).trim().toLowerCase());
  var inStatus = (requirements, status, query) => requirements.filter((r) => r.status === status && titleMatch(r, query));
  var poolItems = (requirements, query) => inStatus(requirements, "backlog", query).slice().sort(byUpdatedDesc);
  var reviewItems = (requirements, query) => inStatus(requirements, "reviewing", query).slice().sort((a, b) => String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? "")));
  var readyItems = (requirements, query) => inStatus(requirements, "ready", query).slice().sort(byOrder);
  var devItems = (requirements, query) => inStatus(requirements, "in_progress", query).slice().sort(byOrder);
  var pendingItems = (requirements, query) => inStatus(requirements, "pending", query).slice().sort(byUpdatedDesc);
  var boardItems = (requirements, query, status) => inStatus(requirements, status, query).slice().sort(byOrder);
  function recordItems(requirements, { query = "", decision = "" } = {}) {
    const needle = String(query ?? "").trim().toLowerCase();
    const out = [];
    for (const req of requirements) {
      for (const record of reviewRecords(req.reviews)) {
        if (record.kind !== "acceptance") continue;
        if (decision && record.decision !== decision) continue;
        if (needle && ![req.title, record.opinion, record.summary].some((v) => String(v ?? "").toLowerCase().includes(needle))) continue;
        out.push({ reqId: req.id, reqTitle: req.title, reqStatus: req.status, ...record });
      }
    }
    return out.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  }
  function blockedItems(requirements, { query = "", reqId = "" } = {}) {
    const out = [];
    for (const req of requirements) {
      if (reqId && req.id !== reqId) continue;
      for (const issue of req.issues ?? []) {
        if (issue.status !== "blocked" || !titleMatch(issue, query)) continue;
        out.push({ reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, reason: issue.blocked_reason ?? "", at: Number(issue.blockedAt) || Date.parse(issue.updated) || 0 });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }
  function failureItems(requirements) {
    const out = [];
    for (const req of requirements) {
      for (const issue of req.issues ?? []) {
        if (TERMINAL_ISSUE.has(issue.status) || !(issue.verification?.failed > 0)) continue;
        out.push({ reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, failed: issue.verification.failed, at: Number(issue.objectiveAt) || Date.parse(issue.updated) || 0 });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }
  var DRAFT_KINDS = ["req_draft", "new_task", "field_draft"];
  var riskItems = (proposals) => (proposals ?? []).filter((p) => p.status === "pending" && !DRAFT_KINDS.includes(p.kind));
  function reorderPlan(list, id, direction) {
    const index = list.findIndex((item) => item.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= list.length) return [];
    const orders = list.map((item) => typeof item.order === "number" && Number.isFinite(item.order) ? item.order : null);
    if (orders.every((o) => o !== null) && new Set(orders).size === orders.length) {
      return [{ id: list[index].id, order: orders[target] }, { id: list[target].id, order: orders[index] }];
    }
    const positions = list.map((_, i) => i);
    [positions[index], positions[target]] = [positions[target], positions[index]];
    return list.map((item, i) => ({ id: item.id, order: positions[i] })).filter((patch, i) => patch.order !== orders[i]);
  }
  async function continueReorder(operation, { read, write, progress = () => {
  } }) {
    let current;
    if (operation.error) {
      const result = await read();
      if (!result.ok) {
        operation.error = result;
        return operation;
      }
      current = new Map(result.items.map((item) => [item.id, item]));
      if (operation.kind === "issue" && operation.before && current.size !== operation.before.length) {
        operation.error = { code: "CONFLICT" };
        return operation;
      }
      const completed = new Map(operation.steps.slice(0, operation.next).map((step) => [step.id, step.order]));
      const remaining = new Set(operation.steps.slice(operation.next).map((step) => step.id));
      for (const original of operation.before ?? []) {
        const item = current.get(original.id);
        if (!item || completed.has(original.id) && item.order !== completed.get(original.id) || !completed.has(original.id) && !remaining.has(original.id) && item.order !== original.order) {
          operation.error = { code: "CONFLICT" };
          return operation;
        }
      }
      for (const step of operation.steps.slice(operation.next)) {
        const item = current.get(step.id);
        if (!item || item.order !== step.order && item.hash !== step.hash) {
          operation.error = { code: "CONFLICT" };
          return operation;
        }
      }
    }
    operation.error = null;
    while (operation.next < operation.steps.length) {
      const step = operation.steps[operation.next];
      if (current?.get(step.id)?.order !== step.order) {
        const result = await write(step);
        if (!result.ok) {
          operation.error = result;
          return operation;
        }
      }
      operation.next++;
      progress(operation);
    }
    if (operation.before) {
      const result = await read();
      if (!result.ok) {
        operation.error = result;
        return operation;
      }
      const items = new Map(result.items.map((item) => [item.id, item]));
      const targets = new Map(operation.steps.map((step) => [step.id, step.order]));
      if (operation.kind === "issue" && items.size !== operation.before.length || operation.before.some((original) => !items.has(original.id) || items.get(original.id).order !== (targets.has(original.id) ? targets.get(original.id) : original.order))) {
        operation.error = { code: "CONFLICT" };
      }
    }
    return operation;
  }
  function waitParts(sinceMs, now = Date.now()) {
    const minutes = Math.max(0, Math.floor((now - Number(sinceMs || now)) / 6e4));
    if (minutes < 1) return { key: "waitNow", n: 0 };
    if (minutes < 60) return { key: "waitMinute", n: minutes };
    if (minutes < 1440) return { key: "waitHour", n: Math.floor(minutes / 60) };
    return { key: "waitDay", n: Math.floor(minutes / 1440) };
  }

  // client-src/pages/home.js
  var import_react7 = __toESM(__require("react"), 1);
  var h7 = import_react7.default.createElement;
  var REMINDER_ACTION = {
    blocked: { label: "homeGoHandle", target: "task" },
    awaitingAuth: { label: "homeGoHandle", target: "session" },
    inReview: { label: "homeGoConfirm", target: "session" },
    pending: { label: "homeGoAccept", target: "delivery" },
    reviewing: { label: "homeGoReview", target: "requirement" },
    ready: { label: "homeViewPlan", target: "requirement" }
  };
  var COUNT_PAGES = [
    { key: "reviewing", page: "review", label: "col_reviewing" },
    { key: "ready", page: "ready", label: "col_ready" },
    { key: "in_progress", page: "dev", label: "col_in_progress" },
    { key: "pending", page: "pending", label: "col_pending" },
    { key: "blocked", page: "blocked", label: "homeBlockedTasks" }
  ];
  function HomePage({ wb }) {
    const { t, home, homeError, runError, requirements, refreshHome, setModal, navigate, openDetail: openDetail2, openTaskSession, awaitingAuthSessions: awaitingAuthSessions2 } = wb;
    if (homeError && !home) {
      return h7(
        "div",
        { className: "pw-init" },
        h7("h2", null, t("readFailedTitle")),
        h7(ErrorDetails, { error: homeError, t, showRaw: false }),
        h7("button", { className: "pw-button primary", onClick: refreshHome }, t("retry"))
      );
    }
    if (!home) return h7("div", { className: "pw-init" }, h7("p", null, t("loading")));
    const go = (item) => {
      const action = REMINDER_ACTION[item.kind] ?? REMINDER_ACTION.blocked;
      if (item.kind === "awaitingAuth" || item.kinds?.includes("awaitingAuth")) {
        const sessionId = awaitingAuthSessions2?.get(item.issueId);
        return sessionId ? openTaskSession(item.issueId, sessionId) : refreshHome();
      }
      if (action.target === "session") return openTaskSession(item.issueId);
      if (action.target === "task") return openDetail2({ reqId: item.reqId, issueId: item.issueId }, "dev");
      if (action.target === "delivery") return openDetail2({ reqId: item.reqId, issueId: null }, "pending");
      return openDetail2({ reqId: item.reqId, issueId: null }, item.kind === "reviewing" ? "review" : "ready");
    };
    const reminders = home.reminders ?? [];
    const counts = home.counts ?? {};
    const incomplete = homeSummaryIncomplete(home, homeError);
    return h7(
      "div",
      { className: "pw-home" },
      h7(
        "section",
        { className: "pw-subpage", "aria-label": t("homeNeedsYou") },
        h7("h2", { className: "pw-home-title" }, t("homeNeedsYou")),
        incomplete && h7(
          "div",
          { className: "pw-banner pw-warn", role: "status" },
          h7("span", null, t(runError ? "runFactsUnavailable" : "homeIncomplete")),
          h7("button", { className: "pw-button", onClick: refreshHome }, t("retryRead"))
        ),
        home.authRefreshing && h7(
          "div",
          { className: "pw-banner pw-warn", role: "status" },
          h7("span", null, t("authRemindersRefreshing")),
          h7("button", { className: "pw-button", onClick: refreshHome }, t("retryRead"))
        ),
        reminders.length === 0 ? !incomplete && !home.authRefreshing && h7("p", { className: "pw-note" }, requirements.length === 0 ? t("homeFirstRequirement") : t("homeNothing")) : h7("div", { className: "pw-home-list" }, reminders.map((item) => {
          const wait = item.waitingSince == null ? null : waitParts(item.waitingSince);
          const hasAuth = item.kind === "awaitingAuth" || item.kinds?.includes("awaitingAuth");
          let waitText = wait ? t(wait.key).replace("{n}", String(wait.n)) : t("waitUnknown");
          if (!wait && hasAuth) {
            const key = item.kinds?.includes("blocked") ? "blockedAndAuthWaitUnknown" : item.kinds?.includes("inReview") ? "confirmationAndAuthWaitUnknown" : "authWaitUnknown";
            waitText = t(key);
          }
          if (wait && hasAuth) {
            const authWait = item.authWaitingSince == null ? null : waitParts(item.authWaitingSince);
            const authText = authWait ? t(authWait.key).replace("{n}", String(authWait.n)) : null;
            if (item.waitingKind === "blocked") waitText = authText ? t("blockedWaitWithAuth").replace("{wait}", waitText).replace("{auth}", authText) : t("blockedWaitWithUnknownAuth").replace("{wait}", waitText);
            else if (item.waitingKind === "inReview") waitText = authText ? t("confirmationWaitWithAuth").replace("{wait}", waitText).replace("{auth}", authText) : t("confirmationWaitWithUnknownAuth").replace("{wait}", waitText);
            else if (item.waitingKind === "awaitingAuth" && authText) waitText = t("authRequestWait").replace("{wait}", authText);
          }
          const action = REMINDER_ACTION[item.kind] ?? REMINDER_ACTION.blocked;
          return h7(
            "div",
            { key: (item.issueId ?? item.reqId) + "|" + item.kind, className: "pw-home-item" },
            h7(
              "div",
              { className: "pw-home-copy" },
              h7("strong", { className: "pw-preview" }, item.title),
              h7(
                "span",
                { className: "pw-note" },
                item.issueId && item.reqTitle ? item.reqTitle + " \xB7 " : "",
                (item.reasons ?? []).join("\u3001"),
                " \xB7 ",
                waitText
              )
            ),
            h7("button", { className: "pw-button", onClick: () => go(item) }, t(action.label))
          );
        })),
        !incomplete && requirements.length === 0 && h7("button", { className: "pw-button primary", onClick: () => setModal({ kind: "createRequirement" }) }, t("newRequirement"))
      ),
      h7(
        "section",
        { className: "pw-subpage", "aria-label": t("homeProgress") },
        h7("h2", { className: "pw-home-title" }, t("homeProgress")),
        h7("div", { className: "pw-home-counts" }, COUNT_PAGES.map(({ key, page, label }) => h7(
          "button",
          { key, className: "pw-home-count", onClick: () => navigate(page) },
          h7("strong", null, incomplete ? "\u2014" : String(counts[key] ?? 0)),
          h7("span", null, t(label))
        )))
      )
    );
  }

  // client-src/pages/requirements.js
  var import_react9 = __toESM(__require("react"), 1);

  // client-src/shared/list.js
  var import_react8 = __toESM(__require("react"), 1);
  var h8 = import_react8.default.createElement;
  function ListPage({ wb, page, items, renderRow, emptyText, emptyAction, toolbar }) {
    const { t, setFilter } = wb;
    const query = (wb.nav.filters[page] ?? {}).query ?? "";
    return h8(
      "div",
      { className: "pw-list" },
      h8(
        "div",
        { className: "pw-list-toolbar" },
        toolbar,
        h8("input", { className: "pw-input", style: { maxWidth: 220 }, placeholder: t("search"), value: query, "aria-label": t("search"), onChange: (e) => setFilter(page, { query: e.target.value }) }),
        query && items.length === 0 && h8("button", { className: "pw-button pw-quiet", onClick: () => setFilter(page, { query: "" }) }, t("clearFilter"))
      ),
      items.length === 0 ? h8(
        "div",
        { className: "pw-empty" },
        query ? t("noResults") : emptyText,
        !query && emptyAction
      ) : h8("div", { className: "pw-list-rows" }, items.map(renderRow))
    );
  }
  var dateText = (value) => String(value ?? "").replace("T", " ").slice(0, 16);

  // client-src/pages/requirements.js
  var h9 = import_react9.default.createElement;
  var Row = ({ req, page, wb, meta, actions }) => {
    const { t, openDetail: openDetail2, locateBoard } = wb;
    return h9(
      "div",
      { className: "pw-row", key: req.id },
      h9(
        "button",
        { className: "pw-row-main", onClick: () => openDetail2({ reqId: req.id, issueId: null }, page), title: req.title },
        h9("strong", { className: "pw-preview" }, req.title),
        meta
      ),
      h9(
        "div",
        { className: "pw-row-actions" },
        actions,
        h9("button", { className: "pw-button pw-quiet", onClick: () => locateBoard(req) }, t("locateBoard"))
      )
    );
  };
  function PoolPage({ wb }) {
    const { t, requirements, setModal } = wb;
    const query = (wb.nav.filters.pool ?? {}).query ?? "";
    const items = poolItems(requirements, query);
    return h9(ListPage, {
      wb,
      page: "pool",
      items,
      toolbar: h9("button", { className: "pw-button", onClick: () => setModal({ kind: "createRequirement" }) }, t("newRequirement")),
      emptyText: t("homeFirstRequirement"),
      emptyAction: h9("button", { className: "pw-button primary", style: { marginLeft: 8 }, onClick: () => setModal({ kind: "createRequirement" }) }, t("newRequirement")),
      renderRow: (req) => h9(Row, {
        req,
        page: "pool",
        wb,
        key: req.id,
        meta: h9(
          import_react9.default.Fragment,
          null,
          h9("span", { className: "pw-preview pw-note" }, requirementOverview(req) || t("requirementMissing").replace("{fields}", t("requirementOverview"))),
          h9(
            "span",
            { className: "pw-count" },
            t("updated"),
            " ",
            dateText(req.updated),
            req.derived?.needsClarification && h9("span", { className: "pw-flag clarify", style: { marginLeft: 8 } }, t("flag_clarify"))
          )
        )
      })
    });
  }
  function ReviewPage({ wb }) {
    const { t, requirements, navigate } = wb;
    const query = (wb.nav.filters.review ?? {}).query ?? "";
    const items = reviewItems(requirements, query);
    return h9(ListPage, {
      wb,
      page: "review",
      items,
      emptyText: t("reviewEmpty"),
      emptyAction: h9("button", { className: "pw-button", style: { marginLeft: 8 }, onClick: () => navigate("board") }, t("locateBoard")),
      renderRow: (req) => {
        const latest = reviewRecords(req.reviews).find((r) => r.kind === "review");
        return h9(Row, {
          req,
          page: "review",
          wb,
          key: req.id,
          meta: h9(
            import_react9.default.Fragment,
            null,
            h9("span", { className: "pw-count" }, t("submittedAt"), " ", dateText(req.submittedAt)),
            h9("span", { className: "pw-preview pw-note" }, latest?.opinion?.trim() || t("noOpinion"))
          )
        });
      }
    });
  }
  function ReadyPage({ wb }) {
    const { t, requirements, navigate, reorder } = wb;
    const query = (wb.nav.filters.ready ?? {}).query ?? "";
    const items = readyItems(requirements, query);
    return h9(ListPage, {
      wb,
      page: "ready",
      items,
      emptyText: t("readyEmpty"),
      emptyAction: h9("button", { className: "pw-button", style: { marginLeft: 8 }, onClick: () => navigate("board") }, t("locateBoard")),
      renderRow: (req, index) => h9(Row, {
        req,
        page: "ready",
        wb,
        key: req.id,
        meta: h9("span", { className: "pw-count" }, t("reviewedAt"), " ", dateText(req.reviewedAt)),
        actions: h9(
          "span",
          { className: "pw-order" },
          h9("button", { className: "pw-orderbtn", disabled: index === 0, "aria-label": t("moveUp"), title: t("moveUp"), onClick: () => reorder("requirement", null, items, req.id, "up") }, "\u2191"),
          h9("button", { className: "pw-orderbtn", disabled: index === items.length - 1, "aria-label": t("moveDown"), title: t("moveDown"), onClick: () => reorder("requirement", null, items, req.id, "down") }, "\u2193")
        )
      })
    });
  }

  // client-src/pages/development.js
  var import_react10 = __toESM(__require("react"), 1);
  var h10 = import_react10.default.createElement;
  function DevPage({ wb }) {
    const { t, requirements, navigate, openDetail: openDetail2 } = wb;
    const query = (wb.nav.filters.dev ?? {}).query ?? "";
    const items = devItems(requirements, query);
    return h10(ListPage, {
      wb,
      page: "dev",
      items,
      emptyText: t("devEmpty"),
      emptyAction: h10("button", { className: "pw-button", style: { marginLeft: 8 }, onClick: () => navigate("board") }, t("locateBoard")),
      renderRow: (req) => {
        const d = req.derived ?? {};
        const total = (req.issues ?? []).length;
        const pct = d.progress == null ? null : Math.round(d.progress * 100);
        const latest = latestOf(req, t);
        return h10(
          "div",
          { className: "pw-row", key: req.id },
          h10(
            "button",
            { className: "pw-row-main", onClick: () => openDetail2({ reqId: req.id, issueId: null }, "dev"), title: req.title },
            h10("strong", { className: "pw-preview" }, req.title),
            h10(
              "span",
              { className: "pw-count" },
              t("taskCount").replace("{total}", String(total)).replace("{done}", String(d.doneCount ?? 0)),
              d.inReviewCount > 0 && " \xB7 " + t("devInReview").replace("{n}", String(d.inReviewCount)),
              d.blockedCount > 0 && " \xB7 " + t("devBlocked").replace("{n}", String(d.blockedCount)),
              d.cancelledCount > 0 && " \xB7 " + t("cancelledCount").replace("{n}", String(d.cancelledCount))
            ),
            h10(
              "span",
              { className: "pw-dev-progress" },
              pct === null ? h10("span", { className: "pw-count" }, t("noProgress")) : h10("span", { className: "pw-bar", title: `${pct}%` }, h10("span", { style: { width: pct + "%" } })),
              latest && h10("span", { className: "pw-preview pw-note" }, latest)
            )
          ),
          h10(
            "div",
            { className: "pw-row-actions" },
            h10("button", { className: "pw-button pw-quiet", onClick: () => wb.locateBoard(req) }, t("locateBoard"))
          )
        );
      }
    });
  }
  function latestOf(req, t) {
    let best = null;
    for (const line of req.activity ?? []) {
      const at = Date.parse(String(line).match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*/)?.[0] ?? "");
      if (Number.isFinite(at) && (!best || at > best.at)) best = { at, line, kind: "requirement" };
    }
    for (const issue of req.issues ?? []) {
      for (const line of issue.activity ?? []) {
        const at = Date.parse(String(line).match(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}\S*/)?.[0] ?? "");
        if (Number.isFinite(at) && (!best || at > best.at)) best = { at, line, kind: "issue" };
      }
    }
    return best ? activityEntry(best.line, t, best.kind).text : "";
  }
  function BlockedPage({ wb }) {
    const { t, requirements, runFacts, runError, refreshBlocked, awaitingAuthSessions: awaitingAuthSessions2, authDetails, blocked, openDetail: openDetail2, openTaskSession, locateBoard, locateTask, setFilter, navigate } = wb;
    const filters = wb.nav.filters.blocked ?? {};
    const query = filters.query ?? "";
    const reqId = filters.reqId ?? "";
    const blockedList = blockedItems(requirements, { query, reqId });
    const authList = (runFacts ?? []).filter((f) => awaitingAuthSessions2.has(f.issueId)).map((f) => {
      const req = requirements.find((r) => r.id === f.reqId);
      const issue = req?.issues?.find((i) => i.id === f.issueId);
      return issue ? { reqId: req.id, issueId: issue.id, title: issue.title, reqTitle: req.title, sessionId: awaitingAuthSessions2.get(f.issueId) } : null;
    }).filter(Boolean).filter((item2) => (!reqId || item2.reqId === reqId) && (!query || item2.title.toLowerCase().includes(query.toLowerCase())));
    const failures = failureItems(requirements).filter((item2) => (!reqId || item2.reqId === reqId) && (!query || item2.title.toLowerCase().includes(query.toLowerCase())));
    const deliveryFailed = (blocked?.deliveryFailed ?? []).filter((item2) => (!reqId || item2.reqId === reqId) && (!query || item2.title.toLowerCase().includes(query.toLowerCase())));
    const risks = riskItems(blocked?.proposals).filter((p) => {
      const req = requirements.find((r) => r.id === p.target?.reqId);
      if (!req || reqId && req.id !== reqId) return false;
      const issue = req.issues?.find((i) => i.id === p.target?.issueId);
      const title = issue?.title ?? req.title;
      return !query || title.toLowerCase().includes(query.toLowerCase());
    });
    const total = blockedList.length + authList.length + failures.length + deliveryFailed.length + risks.length;
    const item = (key, title, reqTitle, reason, at, actions) => h10(
      "div",
      { className: "pw-row", key },
      h10(
        "div",
        { className: "pw-row-main pw-row-static" },
        h10("strong", { className: "pw-preview" }, title),
        h10("span", { className: "pw-note" }, reqTitle, " \xB7 ", reason),
        at ? h10("span", { className: "pw-count" }, dateText(new Date(at).toISOString())) : null
      ),
      h10("div", { className: "pw-row-actions" }, actions)
    );
    const section = (label, children) => h10(
      "section",
      { className: "pw-subpage pw-blocked-section", "aria-label": label },
      h10("h3", { className: "pw-home-title" }, label),
      children
    );
    return h10(
      "div",
      { className: "pw-list" },
      h10(
        "div",
        { className: "pw-list-toolbar" },
        h10("input", { className: "pw-input", style: { maxWidth: 220 }, placeholder: t("search"), value: query, "aria-label": t("search"), onChange: (e) => setFilter("blocked", { query: e.target.value }) }),
        h10(
          "select",
          { className: "pw-select", value: reqId, "aria-label": t("parentRequirement"), onChange: (e) => setFilter("blocked", { reqId: e.target.value }) },
          h10("option", { value: "" }, t("allRequirements")),
          requirements.map((r) => h10("option", { key: r.id, value: r.id }, r.title))
        ),
        (query || reqId) && h10("button", { className: "pw-button pw-quiet", onClick: () => setFilter("blocked", { query: "", reqId: "" }) }, t("clearFilter"))
      ),
      runError && h10(
        "div",
        { className: "pw-banner pw-warn", role: "status" },
        h10("span", null, t("runFactsUnavailable")),
        h10("button", { className: "pw-button", onClick: refreshBlocked }, t("retryRead"))
      ),
      !runError && runFacts == null && h10("p", { className: "pw-note", role: "status" }, t("loading")),
      total === 0 && !runError && runFacts != null && h10("div", { className: "pw-empty" }, query || reqId ? t("noResults") : t("blockedEmpty")),
      blockedList.length > 0 && section(t("blockedSection"), blockedList.map((b) => item(
        "b" + b.issueId,
        b.title,
        b.reqTitle,
        b.reason || t("taskNoReason"),
        b.at,
        h10("button", { className: "pw-button", onClick: () => openDetail2({ reqId: b.reqId, issueId: b.issueId }, "dev") }, t("viewOriginalTask"))
      ))),
      authList.length > 0 && section(t("authSection"), authList.map((a) => item(
        "a" + a.issueId,
        a.title,
        a.reqTitle,
        t("runWaiting") + " \xB7 " + (() => {
          const at = authDetails?.get(a.issueId)?.askedAt;
          if (at == null) return t("authWaitUnknown");
          const date = new Date(at);
          const pad = (value) => String(value).padStart(2, "0");
          const when = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
          return t("authRequestWait").replace("{wait}", when);
        })(),
        null,
        h10("button", { className: "pw-button", onClick: () => openTaskSession(a.issueId, a.sessionId) }, t("goAuthorize"))
      ))),
      (failures.length > 0 || deliveryFailed.length > 0) && section(t("failureSection"), [
        ...failures.map((f) => item(
          "f" + f.issueId,
          f.title,
          f.reqTitle,
          t("checksFailed").replace("{n}", String(f.failed)),
          f.at,
          h10("button", { className: "pw-button", onClick: () => openDetail2({ reqId: f.reqId, issueId: f.issueId }, "dev") }, t("viewFailureReason"))
        )),
        ...deliveryFailed.map((d) => item(
          "d" + d.reqId,
          d.title,
          t("requirementDelivery"),
          t("demoDeliveryFailed"),
          d.at,
          h10("button", { className: "pw-button", onClick: () => openDetail2({ reqId: d.reqId, issueId: null }, "dev") }, t("viewOriginalTask"))
        ))
      ]),
      blocked?.proposals == null ? section(t("riskSection"), h10("p", { className: "pw-note" }, t("loading"))) : risks.length > 0 && section(t("riskSection"), risks.map((p) => {
        const req = requirements.find((r) => r.id === p.target.reqId);
        const issue = req?.issues?.find((i) => i.id === p.target.issueId);
        return item(
          "r" + p.id,
          issue?.title ?? req.title,
          req.title,
          p.reason,
          Date.parse(p.createdAt) || 0,
          h10(
            "button",
            { className: "pw-button", onClick: () => issue ? locateTask(req.id, issue.id) : locateBoard(req) },
            t(issue ? "syncLocateTask" : "syncLocateRequirement")
          )
        );
      }))
    );
  }

  // client-src/pages/board.js
  var import_react11 = __toESM(__require("react"), 1);
  var h11 = import_react11.default.createElement;
  var { useEffect: useEffect4, useRef: useRef2, useState: useState5 } = import_react11.default;
  var COL_ACCENT = { reviewing: "var(--dsw-alias-brand-primary)", ready: "var(--dsw-alias-label-secondary)", backlog: "var(--dsw-alias-label-tertiary)", in_progress: "var(--dsw-alias-brand-primary)", pending: "var(--dsw-alias-state-warn-primary)", completed: "var(--dsw-alias-state-success-primary)" };
  var flagOf = (d) => d.blocked ? "blocked" : d.needsClarification ? "clarify" : d.submittable ? "submittable" : d.stalled ? "stalled" : d.acceptable ? "acceptable" : null;
  function BoardPage({ wb }) {
    const { t, requirements, saving, modal, setModal, doMove, navigate, openDetail: openDetail2, setFilter } = wb;
    const filters = wb.nav.filters.board ?? {};
    const query = filters.query ?? "";
    const showCompleted = !!filters.showCompleted;
    const cursorId = filters.cursor ?? null;
    const [dragOver, setDragOver] = useState5(null);
    const [dragging, setDragging] = useState5(null);
    const dragSource = useRef2(null);
    const skipCardClick = useRef2(false);
    const newRef = useRef2(null);
    const visible = requirements.filter((r) => !query || r.title.toLowerCase().includes(query.toLowerCase()));
    const setCursor = (id) => setFilter("board", { cursor: id });
    const columnAt = (event) => document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-requirement-column]")?.dataset.requirementColumn;
    const moved = (event, start) => Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 6;
    const clearDrag = () => {
      dragSource.current = null;
      setDragging(null);
      setDragOver(null);
    };
    const finishDrag = (event) => {
      const start = dragSource.current;
      if (!start || event.button !== 0) return;
      clearDrag();
      if (!start.active && !moved(event, start)) return;
      skipCardClick.current = true;
      const target = columnAt(event);
      const req = requirements.find((item) => item.id === start.id);
      if (target && req) doMove(req, target);
    };
    useEffect4(() => {
      const onKey = (e) => {
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) {
          if (e.key === "Escape") e.target.blur();
          return;
        }
        if (modal || wb.nav.params) return;
        const flat = visible.filter((r) => r.status !== "completed" || showCompleted);
        const idx = flat.findIndex((r) => r.id === cursorId);
        const cursor = flat.find((r) => r.id === cursorId) ?? null;
        if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          newRef.current?.click();
        } else if (["j", "k"].includes(e.key.toLowerCase())) {
          e.preventDefault();
          const next = e.key.toLowerCase() === "j" ? Math.min(idx + 1, flat.length - 1) : Math.max(idx - 1, 0);
          const id = flat[next]?.id;
          if (id) {
            setCursor(id);
            wb.setFocusTarget("pw-board-" + id);
          }
        } else if (e.key === "Enter" && cursor && tag !== "button") openDetail2({ reqId: cursor.id, issueId: null });
        else if (e.key === "Escape") setCursor(null);
        else if ((e.key === "h" || e.key === "H" || e.key === "l" || e.key === "L") && cursor) {
          e.preventDefault();
          const ci = COLS.indexOf(cursor.status);
          const left = e.key.toLowerCase() === "h";
          const candidates = left ? COLS.slice(0, ci).reverse() : COLS.slice(ci + 1);
          const target = candidates.find((status) => MOVES[cursor.status]?.[status]);
          if (target) doMove(cursor, target);
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [visible, cursorId, requirements, showCompleted, modal, wb.nav.params, doMove]);
    const card = (r) => {
      const d = r.derived ?? {};
      const flag = flagOf(d);
      const pct = d.progress == null ? null : Math.round(d.progress * 100);
      const preview = requirementOverview(r) || r.background?.trim();
      const reopenItems = r.pendingReopen?.items ?? [];
      return h11(
        "div",
        { key: r.id, className: "pw-card-shell" },
        h11(
          "div",
          {
            id: "pw-board-" + r.id,
            className: "pw-card" + (r.id === cursorId ? " selected" : ""),
            tabIndex: 0,
            role: "button",
            "aria-label": r.title,
            onClick: () => {
              if (skipCardClick.current) {
                skipCardClick.current = false;
                return;
              }
              setCursor(r.id);
              openDetail2({ reqId: r.id, issueId: null });
            },
            onFocus: () => setCursor(r.id),
            onKeyDown: (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              setCursor(r.id);
              openDetail2({ reqId: r.id, issueId: null });
            },
            onPointerDown: (e) => {
              skipCardClick.current = false;
              if (e.button !== 0 || saving || modal || r.pendingReopen) return;
              dragSource.current = { id: r.id, pointer: e.pointerId, x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            },
            onPointerMove: (e) => {
              const start = dragSource.current;
              if (start?.pointer !== e.pointerId || !start.active && !moved(e, start)) return;
              start.active = true;
              setDragging(r.id);
              setDragOver(columnAt(e));
            },
            onPointerCancel: clearDrag
          },
          h11("p", { className: "pw-cardtitle pw-preview" }, r.title),
          h11(
            "div",
            { className: "pw-cardmeta" },
            pct !== null && h11("div", { className: "pw-bar", title: `${pct}%` }, h11("span", { style: { width: pct + "%" } })),
            flag && h11("span", { className: "pw-flag " + flag }, t("flag_" + flag))
          ),
          preview && h11("div", { className: "pw-next pw-preview" }, preview)
        ),
        r.pendingReopen && h11(
          "button",
          {
            className: "pw-button pw-card-retry",
            disabled: saving,
            onClick: () => setModal({ kind: "reopenRequirement", req: r })
          },
          t("resumeReopen") + " \xB7 " + t("reopenProgress").replace("{done}", String(reopenItems.filter((item) => item.done).length)).replace("{total}", String(reopenItems.length))
        )
      );
    };
    const dragged = requirements.find((item) => item.id === dragging);
    const column = (state) => {
      const items = boardItems(visible, "", state);
      const collapsed = state === "completed" && !showCompleted;
      const allowed = dragged && !dragged.pendingReopen && MOVES[dragged.status]?.[state];
      return h11(
        "div",
        {
          key: state,
          className: "pw-col" + (allowed ? " pw-drop-target" : "") + (allowed && dragOver === state ? " dragover" : ""),
          "data-requirement-column": state
        },
        h11(
          "div",
          { className: "pw-colhead" },
          h11("span", { className: "pw-dot", style: { background: COL_ACCENT[state] } }),
          t("col_" + state),
          h11("span", { className: "pw-count" }, String(items.length)),
          state === "completed" && !collapsed && h11("button", { className: "pw-button", style: { marginLeft: "auto", minHeight: 22, padding: "0 6px", fontSize: 12 }, onClick: () => setFilter("board", { showCompleted: false }) }, t("collapse"))
        ),
        collapsed ? h11("button", { className: "pw-button", onClick: () => setFilter("board", { showCompleted: true }) }, t("expand")) : h11("div", { className: "pw-cards" }, items.length ? items.map(card) : h11("div", { className: "pw-empty" }, t("empty")))
      );
    };
    return h11(
      import_react11.default.Fragment,
      null,
      h11(
        "div",
        { className: "pw-list-toolbar" },
        h11("button", { className: "pw-button", ref: newRef, disabled: saving, "aria-keyshortcuts": "N", onClick: () => setModal({ kind: "createRequirement" }) }, t("newRequirement")),
        h11("input", { className: "pw-input", style: { maxWidth: 220 }, placeholder: t("search"), value: query, "aria-label": t("search"), onChange: (e) => setFilter("board", { query: e.target.value }) }),
        query && visible.length === 0 && h11("button", { className: "pw-button pw-quiet", onClick: () => setFilter("board", { query: "" }) }, t("clearFilter"))
      ),
      query && visible.length === 0 ? h11("div", { className: "pw-empty" }, t("noResults")) : h11("div", { className: "pw-board", onPointerUpCapture: finishDrag, onMouseUpCapture: finishDrag }, COLS.map(column))
    );
  }

  // client-src/pages/acceptance.js
  var import_react12 = __toESM(__require("react"), 1);
  var h12 = import_react12.default.createElement;
  function PendingPage({ wb }) {
    const { t, requirements, navigate, openDetail: openDetail2 } = wb;
    const query = (wb.nav.filters.pending ?? {}).query ?? "";
    const items = pendingItems(requirements, query);
    return h12(ListPage, {
      wb,
      page: "pending",
      items,
      emptyText: t("pendingEmpty"),
      emptyAction: h12("button", { className: "pw-button", style: { marginLeft: 8 }, onClick: () => navigate("board") }, t("locateBoard")),
      renderRow: (req) => {
        const result = requirementResult(req);
        const d = req.derived ?? {};
        const returned = reviewRecords(req.reviews).find((r) => r.kind === "acceptance" && r.decision === "returned");
        return h12(
          "div",
          { className: "pw-row", key: req.id },
          h12(
            "button",
            { className: "pw-row-main", onClick: () => openDetail2({ reqId: req.id, issueId: null }, "pending"), title: req.title },
            h12("strong", { className: "pw-preview" }, req.title),
            h12("span", { className: "pw-preview pw-note" }, (result.summary || result.previousSummary).split(/\r?\n/)[0] || t("missingDeliverySummary")),
            h12(
              "span",
              { className: "pw-count" },
              t("taskCount").replace("{total}", String((req.issues ?? []).length)).replace("{done}", String(d.doneCount ?? 0)),
              d.cancelledCount > 0 && " \xB7 " + t("cancelledCount").replace("{n}", String(d.cancelledCount)),
              " \xB7 ",
              t("submittedAt"),
              " ",
              dateText(req.updated),
              returned && " \xB7 " + t("wasReturned")
            )
          ),
          h12(
            "div",
            { className: "pw-row-actions" },
            h12("button", { className: "pw-button pw-quiet", onClick: () => wb.locateBoard(req) }, t("locateBoard"))
          )
        );
      }
    });
  }
  function RecordsPage({ wb }) {
    const { t, requirements, openDetail: openDetail2, setFilter } = wb;
    const filters = wb.nav.filters.records ?? {};
    const query = filters.query ?? "";
    const decision = filters.decision ?? "";
    const items = recordItems(requirements, { query, decision });
    return h12(ListPage, {
      wb,
      page: "records",
      items,
      toolbar: h12(
        "select",
        { className: "pw-select", value: decision, "aria-label": t("recordDecision"), onChange: (e) => setFilter("records", { decision: e.target.value }) },
        h12("option", { value: "" }, t("allDecisions")),
        h12("option", { value: "approved" }, t("deliveryAccepted")),
        h12("option", { value: "returned" }, t("deliveryReturned"))
      ),
      emptyText: t("recordsEmpty"),
      renderRow: (record) => h12(
        "div",
        { className: "pw-row", key: record.reqId + "|" + (record.marker || record.round) },
        h12(
          "button",
          { className: "pw-row-main", onClick: () => openDetail2({ record: { reqId: record.reqId, marker: record.marker, round: record.round } }, "records"), title: record.reqTitle },
          h12("strong", { className: "pw-preview" }, record.reqTitle),
          h12(
            "span",
            { className: "pw-count" },
            dateText(record.at),
            " \xB7 ",
            t(record.decision === "approved" ? "deliveryAccepted" : "deliveryReturned")
          ),
          h12("span", { className: "pw-preview pw-note" }, (record.opinion || record.summary || "").split(/\r?\n/)[0] || t("noOpinion"))
        ),
        h12(
          "div",
          { className: "pw-row-actions" },
          h12(
            "span",
            { className: "pw-istatus " + (record.decision === "approved" ? "st-done" : "st-blocked") },
            t(record.decision === "approved" ? "deliveryAccepted" : "deliveryReturned")
          )
        )
      )
    });
  }

  // client-src/pages/resources.js
  var import_react13 = __toESM(__require("react"), 1);

  // client-src/pages/wiki-source.js
  var stripFrontmatter = (content) => String(content ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  function wikiLocalDate(value) {
    if (typeof value !== "string" || !value.trim()) return "";
    const text = value.trim();
    const date = new Date(text);
    if (!Number.isFinite(date.getTime())) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return date.toISOString().slice(0, 10) === text ? text : "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function parseEvidenceRef(ref) {
    const text = String(ref ?? "").trim();
    const repo = text.match(/^repo:\/\/([^#]+)(?:#L(\d+)(?:-L(\d+))?)?$/);
    if (repo) {
      const parts = repo[1].split("/").map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
      if (parts.some((part) => !part || part === "." || part === ".." || /[/\\\0]/.test(part))) return { kind: "text", label: text };
      return { kind: "file", path: parts.join("/"), from: Number(repo[2]) || 0, to: Number(repo[3]) || Number(repo[2]) || 0, label: text };
    }
    const wiki = text.match(/^(?:wiki:|openwiki\/)([^\s#]+\.md)/);
    if (wiki) return { kind: "wiki", path: wiki[1], label: text };
    return { kind: "text", label: text };
  }
  var evidenceLines = (content, from, to) => {
    const lines = String(content ?? "").split(/\r?\n/);
    if (!from) return lines.slice(0, 80).join("\n");
    return lines.slice(from - 1, Math.max(to, from)).join("\n");
  };

  // client-src/pages/resources.js
  var h13 = import_react13.default.createElement;
  var { useCallback, useEffect: useEffect5, useRef: useRef3, useState: useState6 } = import_react13.default;
  var baseName = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  function wikiLink(href, pagePath) {
    if (!pagePath || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href) || /%(?:2f|5c)/i.test(href) || href.includes("\\")) return null;
    try {
      const base = `https://wiki.invalid/openwiki/${pagePath.split("/").map(encodeURIComponent).join("/")}`;
      const url = new URL(href.startsWith("openwiki/") ? "/" + href : href, base);
      if (url.origin !== "https://wiki.invalid" || !url.pathname.startsWith("/openwiki/")) return null;
      const path = decodeURIComponent(url.pathname.slice("/openwiki/".length));
      return path.endsWith(".md") ? path : null;
    } catch {
      return null;
    }
  }
  function inline(text, keyBase, wiki) {
    const nodes = [];
    let rest = text;
    let k = 0;
    const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/;
    while (rest.length) {
      const m = rest.match(re);
      if (!m) {
        nodes.push(rest);
        break;
      }
      if (m.index > 0) nodes.push(rest.slice(0, m.index));
      const tok = m[0];
      if (tok.startsWith("`")) nodes.push(h13("code", { key: keyBase + "-" + k++, className: "pw-inline-code" }, tok.slice(1, -1)));
      else if (tok.startsWith("**")) nodes.push(h13("strong", { key: keyBase + "-" + k++ }, tok.slice(2, -2)));
      else {
        const lm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const path = wikiLink(lm[2], wiki?.pagePath);
        if (path && wiki?.open) nodes.push(h13("a", { key: keyBase + "-" + k++, href: "#", onClick: (event) => {
          event.preventDefault();
          wiki.open(path);
        } }, lm[1]));
        else if (/^https?:\/\//i.test(lm[2])) nodes.push(h13("a", { key: keyBase + "-" + k++, href: lm[2], target: "_blank", rel: "noreferrer" }, lm[1]));
        else nodes.push(lm[1]);
      }
      rest = rest.slice(m.index + tok.length);
    }
    return nodes;
  }
  function CodeBlock({ lang, code, t }) {
    const [copied, setCopied] = useState6(false);
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
      }
    };
    return h13(
      "div",
      { className: "pw-codeblock" },
      h13(
        "div",
        { className: "pw-code-head" },
        h13("span", { className: "pw-code-label" }, lang === "mermaid" ? t("mermaidNote") : lang || "code"),
        h13("button", { className: "pw-button pw-copy", onClick: copy }, copied ? t("copied") : t("copy"))
      ),
      h13("pre", null, code)
    );
  }
  function withoutComments(src) {
    let fenced = false;
    let comment = false;
    return src.split(/\r?\n/).map((line) => {
      if (!comment && /^```/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      let out = "";
      let i = 0;
      let code = false;
      while (i < line.length) {
        if (comment) {
          const end = line.indexOf("-->", i);
          if (end < 0) break;
          comment = false;
          i = end + 3;
        } else if (!code && line.startsWith("<!--", i)) {
          comment = true;
          i += 4;
        } else {
          if (line[i] === "`") code = !code;
          out += line[i++];
        }
      }
      return out;
    }).join("\n");
  }
  function renderMarkdown(src, t, wiki) {
    const lines = withoutComments(src).split(/\r?\n/);
    const out = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        const lang = fence[1];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push(h13(CodeBlock, { key: key++, lang, code: buf.join("\n"), t }));
        continue;
      }
      const head = line.match(/^(#{1,4})\s+(.*)$/);
      if (head) {
        const lvl = head[1].length;
        out.push(h13("h" + lvl, { key: key++, className: "pw-md-h" }, inline(head[2], "h" + key, wiki)));
        i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
          i++;
        }
        out.push(h13("ul", { key: key++, className: "pw-md-ul" }, items.map((it, j) => h13("li", { key: j }, inline(it, "li" + key + "-" + j, wiki)))));
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && lines[i + 1].includes("-") && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
        const splitRow = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const header = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(h13(
          "div",
          { key: key++, className: "pw-md-tablewrap" },
          h13(
            "table",
            { className: "pw-md-table" },
            h13("thead", null, h13("tr", null, header.map((c, j) => h13("th", { key: j }, inline(c, "th" + key + "-" + j, wiki))))),
            h13("tbody", null, rows.map((r, ri) => h13("tr", { key: ri }, r.map((c, ci) => h13("td", { key: ci }, inline(c, "td" + key + "-" + ri + "-" + ci, wiki))))))
          )
        ));
        continue;
      }
      if (line.trim() === "") {
        i++;
        continue;
      }
      out.push(h13("p", { key: key++, className: "pw-md-p" }, inline(line, "p" + key, wiki)));
      i++;
    }
    return out;
  }
  function generationStartMessage(error, fallback, t) {
    if (error?.code === "SESSION_NOT_LIVE") return t("generationNeedsSession");
    if (error?.code === "WORKSPACE_MISMATCH") return t("errWrongWorkspace");
    if (error?.code === "NOT_GIT") return t("wikiNeedsGit");
    if (error?.code === "GIT_MISSING") return t("wikiGitMissing");
    if (error?.code === "WIKI_BUSY") return t("wikiBusy");
    if (error?.code === "WIKI_ROOT_NOT_TOPLEVEL") return t("wikiRootNotTopLevel");
    if (error?.code === "WIKI_ROOT_UNAVAILABLE") return t("wikiRootUnavailable");
    if (error?.code === "WIKI_STATE_UNREADABLE") return t("wikiStateUnreadable");
    if (error?.code === "WIKI_METADATA_UNSAFE") return t("wikiMetadataUnsafe");
    if (error?.code === "WIKI_CHECKPOINT_UNSAFE") return t("wikiCheckpointUnsafe");
    if (error?.code === "WIKI_SNAPSHOT_FAILED") return t("wikiSnapshotFailed");
    if (error?.code === "WIKI_SNAPSHOT_UNREADABLE") return t("wikiSnapshotUnreadable");
    if (error?.code === "WIKI_EXTERNAL_CHANGE") return t("wikiExternalChangeBlocked");
    if (error?.code === "WIKI_STAGING_FAILED") return t("wikiStagingFailed");
    if (error?.code === "WIKI_SOURCE_UNSUPPORTED") return t("wikiSourceUnsupported");
    if (error?.code === "ARCH_SOURCE_REQUIRED") return t("archSourceRequired");
    if (error?.code === "ARCH_SOURCE_INVALID") return t("archSourceInvalid");
    return t(fallback);
  }
  function wikiJobMessage(error, t) {
    if (error === "stopped by user") return t("wikiStopped");
    if (error === "Wiki or source changed during generation") return t("wikiPublishConflict");
    if (error === "Wiki publication failed") return t("wikiPublishFailed");
    if (error === "Wiki was published but its status could not be saved") return t("wikiPublishedStatusFailed");
    if (typeof error === "string" && error.startsWith("Wiki publication needs recovery: ")) {
      return `${t("wikiPublishRecovery")} ${error.slice("Wiki publication needs recovery: ".length)}`;
    }
    return t("wikiTryAgain");
  }
  function WikiView({ root, sessionId, t, target, onPageChange, uiMemory: uiMemory2 }) {
    const [status, setStatus] = useState6(null);
    const [statusError, setStatusError] = useState6(null);
    const [page, setPage] = useState6(null);
    const [evidence, setEvidence] = useState6(null);
    const [err, setErr] = useState6("");
    const [query, setQuery] = useState6("");
    const [source, setSource] = useState6(null);
    const pageSeq = useRef3(0);
    const statusSeq = useRef3(0);
    const [gen, setGen] = useState6(() => uiMemory2.wikiGen[root] ?? null);
    const [genChecked, setGenChecked] = useState6(false);
    const pollRef = useRef3(null);
    const setGenState = (g) => {
      uiMemory2.wikiGen[root] = g;
      setGen(g);
    };
    const stopPoll = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    const loadStatus = useCallback(async () => {
      const seq = ++statusSeq.current;
      const res = await rpc("wiki/status", { root });
      if (seq !== statusSeq.current) return;
      setStatusError(res.ok ? null : res);
      if (res.ok) setStatus(res.data);
    }, [root]);
    const fetchGenStatus = () => fetch("/api/project-workbench/wiki-generate-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).catch(() => null);
    const pollGen = (refresh = loadStatus) => {
      stopPoll();
      pollRef.current = setInterval(async () => {
        const st = await fetchGenStatus();
        const s = st?.data?.status;
        await refresh();
        if (s === "done" || s === "idle") {
          stopPoll();
          const last = st?.data?.last;
          const noop = /WIKI_NOOP/i.test(st?.data?.summary || "");
          if (last?.status === "failed") setGenState({ busy: false, failed: true, message: wikiJobMessage(last.error, t) });
          else setGenState({ busy: false, message: noop ? t("wikiNoop") : t("wikiDone") });
        } else if (s === "failed") {
          stopPoll();
          setGenState({ busy: false, failed: true, message: wikiJobMessage(st?.data?.error, t) });
        } else if (s === "stopping") {
          setGenState({ busy: true, message: t("wikiStopping") });
        } else if (!st?.ok) {
          stopPoll();
          setGenState({ busy: false, failed: true, message: t("generationStatusUnavailable") });
        }
      }, 4e3);
    };
    useEffect5(() => {
      let alive = true;
      fetchGenStatus().then((st) => {
        if (!alive) return;
        if (!st?.ok || !st.data) {
          setGenChecked("error");
          setGenState({ busy: false, message: t("generationStatusUnavailable") });
          return;
        }
        setGenChecked(true);
        const d = st.data;
        if (d.status === "running") {
          setGenState({ busy: true, message: t("wikiGenerating") });
          pollGen();
        } else if (d.status === "stopping") {
          setGenState({ busy: true, message: t("wikiStopping") });
          pollGen();
        } else if (d.status === "done") setGenState({ busy: false, message: /WIKI_NOOP/i.test(d.summary || "") ? t("wikiNoop") : t("wikiDone") });
        else if (d.status === "failed") setGenState({ busy: false, failed: true, message: wikiJobMessage(d.error, t) });
        else if (d.last?.status === "failed") setGenState({ busy: false, failed: true, message: wikiJobMessage(d.last.error, t) });
        else if (uiMemory2.wikiGen[root]?.busy) setGenState(null);
      });
      return () => {
        alive = false;
        stopPoll();
      };
    }, [root]);
    const [collapsed, setCollapsed] = useState6({});
    useEffect5(() => {
      loadStatus();
      return () => {
        pageSeq.current++;
        statusSeq.current++;
      };
    }, [loadStatus]);
    const open = async (path) => {
      const normalized = path.replace(/^openwiki\//, "");
      onPageChange?.(normalized);
      const seq = ++pageSeq.current;
      for (let attempt = 0; attempt < 2; attempt++) {
        const current = await rpc("wiki/status", { root });
        if (seq !== pageSeq.current) return;
        if (!current.ok) {
          setStatusError(current);
          setErr({ path });
          return;
        }
        const viewVersion = current.data.viewVersion;
        const args = { root, path, viewVersion };
        const res = await rpc("wiki/page", args);
        if (seq !== pageSeq.current) return;
        if (!res.ok && res.code === "WIKI_VIEW_CHANGED") continue;
        if (!res.ok) {
          setErr({ path, code: res.code });
          return;
        }
        const ev = await rpc("wiki/evidence", { ...args, viewVersion: res.data.viewVersion ?? viewVersion });
        if (seq !== pageSeq.current) return;
        if (!ev.ok && ev.code === "WIKI_VIEW_CHANGED") continue;
        if (!ev.ok) {
          setErr({ path, code: ev.code });
          return;
        }
        setStatus(current.data);
        setStatusError(null);
        setPage({ ...res.data, viewVersion, viewIsSnapshot: !!current.data.viewIsSnapshot });
        setErr("");
        setEvidence(ev.data);
        return;
      }
      if (seq === pageSeq.current) setErr({ path });
    };
    useEffect5(() => {
      if (page && status?.viewVersion && page.viewVersion && page.viewVersion !== status.viewVersion) void open(page.path);
    }, [status?.viewVersion]);
    useEffect5(() => {
      if (!target) return;
      open(target);
    }, [target]);
    const retryPage = async () => {
      const path = err.path;
      const seq = ++pageSeq.current;
      const fresh = await rpc("wiki/status", { root });
      if (seq !== pageSeq.current) return;
      if (fresh.ok) {
        setStatus(fresh.data);
        setStatusError(null);
      }
      await open(path);
    };
    const openSource = async (ref) => {
      const parsed = parseEvidenceRef(ref);
      if (parsed.kind === "wiki") {
        open(parsed.path);
        return;
      }
      if (parsed.kind !== "file") return;
      setSource({ ...parsed, loading: true });
      const res = await rpc("probe/read", { root, path: parsed.path });
      setSource((current) => current?.label === parsed.label ? res.ok ? { ...parsed, content: evidenceLines(res.data.content, parsed.from, parsed.to) } : { ...parsed, error: res } : current);
    };
    const evidenceItem = (ref) => {
      const parsed = parseEvidenceRef(ref);
      if (parsed.kind === "text") return h13("span", { key: ref, className: "pw-refchip", title: ref }, ref);
      return h13("button", { key: ref, className: "pw-refchip pw-reflink", title: parsed.kind === "file" ? t("sourceOpen") : ref, onClick: () => openSource(ref) }, ref);
    };
    const pageError = err && h13(
      "div",
      { className: "pw-banner pw-error", role: "alert" },
      h13("span", null, err.code === "WIKI_SNAPSHOT_UNREADABLE" ? t("wikiSavedViewUnreadable") : t("wikiUnavailable"), " ", baseName(err.path)),
      h13("button", { className: "pw-button", onClick: retryPage }, t("retry"))
    );
    const readError = statusError && h13(
      "div",
      { className: "pw-banner pw-error", role: "alert" },
      statusError.code === "WIKI_SNAPSHOT_UNREADABLE" ? h13("span", null, t("wikiSavedViewUnreadable")) : h13(ErrorDetails, { error: statusError, t, showRaw: false }),
      h13("button", { className: "pw-button", onClick: loadStatus }, t("retryRead"))
    );
    const generate = async () => {
      setGenState({ busy: true, starting: true, message: t("wikiGenerating") });
      try {
        const res = await fetch("/api/project-workbench/wiki-generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root, sessionId }) });
        const j = await res.json();
        if (!j.ok) {
          setGenState({ busy: false, failed: true, startFailed: true, message: generationStartMessage(j, "wikiTryAgain", t) });
          return;
        }
        setGenState({ busy: true, message: t("wikiGenerating") });
        pollGen();
      } catch {
        setGenState({ busy: false, failed: true, startFailed: true, message: t("wikiTryAgain") });
      }
    };
    const stopGen = async () => {
      setGenState({ busy: true, message: t("wikiStopping") });
      const res = await fetch("/api/project-workbench/wiki-generate-stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).catch(() => null);
      if (!res?.ok) {
        setGenState({ busy: true, message: t("generationStopFailed") });
        return;
      }
      if (res.data?.stopped === false && res.data.reason === "finishing") setGenState({ busy: true, message: t("wikiPublishing") });
      else if (res.data?.stopped === false) setGenState({ busy: true, message: t("generationStopFailed") });
      pollGen();
    };
    const interrupted = genChecked === true && !gen?.busy && status?.lastUpdate?.status === "interrupted";
    const checkpointMessage = null;
    const genMessage = genChecked === false || statusError && !gen?.failed ? null : checkpointMessage || (status?.viewExternalChanged && !gen?.failed ? null : interrupted && !gen?.failed ? t("wikiTryAgain") : gen?.message);
    const lastCompleted = status?.lastCompleted ?? (!status?.viewIsSnapshot && status?.lastUpdate?.status === "complete" ? status.lastUpdate : null);
    const visiblePage = !statusError && page && (!status?.viewVersion || !page.viewVersion || page.viewVersion === status.viewVersion) ? page : null;
    const genError = gen?.startFailed && genMessage ? h13("div", { className: "pw-banner pw-error", role: "alert" }, genMessage) : null;
    const genBar = h13(
      "div",
      { className: "pw-banner", role: "status" },
      h13("button", { className: "pw-button primary", onClick: generate, disabled: genChecked === false || gen?.busy }, status?.exists ? t("wikiUpdate") : t("wikiGenerate")),
      gen?.busy && h13("button", { className: "pw-button", onClick: stopGen }, t("wikiStop")),
      !genError && genMessage && h13("span", { style: { marginLeft: 10 } }, genMessage)
    );
    if (!status && !page) return h13("div", { className: "pw-init" }, readError || h13("p", null, t("loading")));
    if (!status?.exists && !page) return h13("div", { className: "pw-init" }, h13("h2", null, t("wikiTitle")), h13("p", { className: "pw-note" }, t("wikiEmpty")), readError, pageError, genBar, genError);
    const needle = query.trim().toLowerCase();
    const pages = (status?.pages ?? []).filter((p) => !needle || p.toLowerCase().includes(needle));
    const groups = /* @__PURE__ */ new Map();
    const rootPages = [];
    for (const p of pages) {
      const slash = p.indexOf("/");
      if (slash === -1) rootPages.push(p);
      else {
        const g = p.slice(0, slash);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(p);
      }
    }
    const pageBtn = (p) => h13("button", { key: p, className: "pw-wiki-item" + (page?.path === p ? " active" : ""), onClick: () => open(p), title: p }, p.split("/").pop());
    return h13(
      "div",
      { className: "pw-wiki-wrap" },
      genBar,
      genError,
      h13("div", { className: "pw-note" }, t("wikiRebuildNotice")),
      readError,
      status?.viewExternalChanged ? h13("div", { className: "pw-note", role: "status" }, t(status.viewUnavailable ? "wikiNoSavedExternal" : "wikiExternalChangeView")) : (page ? page.viewIsSnapshot : status?.viewIsSnapshot) && h13("div", { className: "pw-note", role: "status" }, t("wikiShowingPrevious")),
      status?.viewUnprotected && h13("div", { className: "pw-note", role: "status" }, t("wikiPreviousUnavailable")),
      h13(
        "div",
        { className: "pw-wiki" },
        h13(
          "aside",
          { className: "pw-wiki-list" },
          h13("strong", null, t("wikiPages")),
          lastCompleted?.updatedAt && h13("div", { className: "pw-count", style: { margin: "4px 0 8px" } }, `${t("wikiLastUpdate")}: ${wikiLocalDate(lastCompleted.updatedAt) || t("wikiDateUnknown")}`),
          h13("input", { className: "pw-input", style: { marginBottom: 6 }, placeholder: t("search"), value: query, onChange: (e) => setQuery(e.target.value), "aria-label": t("wikiSearch") }),
          needle && !pages.length && h13("div", { className: "pw-empty" }, t("noResults")),
          rootPages.map(pageBtn),
          [...groups.entries()].map(([g, pages2]) => h13(
            "div",
            { key: g, className: "pw-wiki-group" },
            h13(
              "button",
              { className: "pw-wiki-grouhead", onClick: () => setCollapsed((c) => ({ ...c, [g]: !c[g] })), "aria-expanded": !collapsed[g] },
              h13("span", { className: "pw-caret" + (collapsed[g] ? " closed" : "") }, "\u25BE"),
              g,
              h13("span", { className: "pw-count" }, String(pages2.length))
            ),
            !collapsed[g] && h13("div", { className: "pw-wiki-groupitems" }, pages2.map(pageBtn))
          ))
        ),
        h13(
          "div",
          { className: "pw-wiki-body" },
          pageError,
          visiblePage ? h13(
            import_react13.default.Fragment,
            null,
            h13("button", { className: "pw-button", style: { marginBottom: 10 }, onClick: () => {
              setPage(null);
              onPageChange?.(null);
            } }, t("wikiBack")),
            h13("div", { className: "pw-md" }, renderMarkdown(stripFrontmatter(visiblePage.content), t, { pagePath: visiblePage.path, open })),
            h13(
              "div",
              { className: "pw-evidence" },
              h13("span", { className: "pw-label" }, t("wikiEvidence")),
              evidence && evidence.claims.length ? evidence.claims.map((c, i) => h13(
                "div",
                { key: i, className: "pw-claim" },
                h13("div", { className: "pw-claim-stmt" }, c.statement),
                h13("div", { className: "pw-claim-ev" }, c.evidence.map(evidenceItem))
              )) : h13("div", { className: "pw-empty", style: { border: "none", padding: "4px 0" } }, t("wikiNoEvidence"))
            )
          ) : h13("div", { className: "pw-empty" }, t("wikiPages"))
        )
      ),
      source && h13(
        Modal,
        {
          title: source.path + (source.from ? ` \xB7 L${source.from}${source.to > source.from ? `\u2013L${source.to}` : ""}` : ""),
          wide: true,
          onClose: () => setSource(null),
          actions: [
            source.error && h13("button", { className: "pw-button", onClick: () => openSource(source.label) }, t("retry")),
            h13("button", { className: "pw-button primary", onClick: () => setSource(null) }, t("ok"))
          ]
        },
        source.loading && h13("p", { className: "pw-note" }, t("loading")),
        source.error && h13("p", { className: "pw-error" }, t("sourceUnavailable")),
        source.content != null && h13("pre", { className: "pw-source-view" }, source.content)
      )
    );
  }
  function ArchView({ root, sessionId, t }) {
    const [arch, setArch] = useState6(null);
    const [run, setRun] = useState6(null);
    const [readError, setReadError] = useState6(null);
    const [source, setSource] = useState6(null);
    const sourceSeq = useRef3(0);
    const timer = useRef3(null);
    const mounted = useRef3(false);
    const stopPoll = useCallback(() => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    }, []);
    const load = useCallback(async () => {
      const res = await rpc("architecture/read", { root });
      if (!mounted.current) return;
      setReadError(res.ok ? null : res);
      if (res.ok) setArch(res.data);
    }, [root]);
    const showRunFailure = useCallback((data) => {
      const stopped = data.error === "stopped by user";
      setRun({ busy: false, failed: !stopped, message: stopped ? t("wikiStopped") : generationStartMessage(data, "archTryAgain", t) });
    }, [t]);
    const poll = useCallback(() => {
      stopPoll();
      timer.current = setInterval(async () => {
        const st = await fetch("/api/project-workbench/arch-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).catch(() => null);
        if (!mounted.current) return;
        const s = st?.data?.status;
        if (st?.data?.phase === "rendering") setRun({ busy: true, message: t("archRendering") });
        else if (st?.data?.phase === "repairing") setRun({ busy: true, message: t("archRepairing") });
        if (s === "done") {
          stopPoll();
          setRun({ busy: false, message: t("archDone") });
          load();
        } else if (s === "failed") {
          stopPoll();
          showRunFailure(st.data);
        } else if (s === "stopping") {
          setRun({ busy: true, message: t("wikiStopping") });
        } else if (s === "idle") {
          stopPoll();
          setRun(null);
        } else if (!st?.ok) {
          stopPoll();
          setRun({ busy: false, message: t("generationStatusUnavailable") });
        }
      }, 4e3);
    }, [root, t, load, stopPoll, showRunFailure]);
    useEffect5(() => {
      mounted.current = true;
      load();
      let alive = true;
      fetch("/api/project-workbench/arch-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).then((st) => {
        if (!alive) return;
        if (st?.data?.status === "running") {
          const ph = st.data.phase;
          setRun({ busy: true, message: ph === "rendering" ? t("archRendering") : ph === "repairing" ? t("archRepairing") : t("archAuthoring") });
          poll();
        } else if (st?.data?.status === "stopping") {
          setRun({ busy: true, message: t("wikiStopping") });
          poll();
        } else if (st?.data?.status === "failed") {
          showRunFailure(st.data);
        }
      }).catch(() => {
      });
      return () => {
        alive = false;
        mounted.current = false;
        stopPoll();
      };
    }, [root, load, poll, stopPoll, t, showRunFailure]);
    const generate = async () => {
      setRun({ busy: true, starting: true, message: t("archAuthoring") });
      const res = await fetch("/api/project-workbench/arch-generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root, sessionId }) }).then((r) => r.json()).catch(() => null);
      if (!mounted.current) return;
      if (!res?.ok) {
        showRunFailure(res ?? {});
        return;
      }
      setRun({ busy: true, message: t("archAuthoring") });
      poll();
    };
    const stop = async () => {
      const res = await fetch("/api/project-workbench/arch-stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).catch(() => null);
      if (!mounted.current) return;
      if (!res?.ok) {
        setRun({ busy: true, message: t("generationStopFailed") });
        return;
      }
      if (!res.data?.stopped) {
        poll();
        return;
      }
      stopPoll();
      setRun({ busy: false, message: t("wikiStopped") });
    };
    const openSource = async (ref) => {
      const token = ++sourceSeq.current;
      const item = { label: ref.label, path: ref.path, from: ref.from, to: ref.to };
      setSource({ ...item, loading: true });
      const res = await rpc("probe/read", { root, path: item.path });
      if (!mounted.current || token !== sourceSeq.current) return;
      setSource(res.ok ? { ...item, content: evidenceLines(res.data.content, item.from, item.to) } : { ...item, error: res });
    };
    const closeSource = () => {
      sourceSeq.current++;
      setSource(null);
    };
    return h13(
      "div",
      { className: "pw-arch" },
      h13(
        "div",
        { className: "pw-banner", role: "status" },
        h13("button", { className: "pw-button primary", onClick: generate, disabled: run?.busy }, arch?.exists ? t("archRegenerate") : t("archGenerate")),
        run?.busy && h13("button", { className: "pw-button", onClick: stop, disabled: run.starting }, t("wikiStop")),
        h13("span", { className: "pw-count", style: { marginLeft: 8 } }, t("archHint")),
        run && !run.failed && h13("span", { style: { marginLeft: 10 } }, run.message)
      ),
      run?.failed && h13("div", { className: "pw-banner pw-error", role: "alert" }, run.message),
      readError && h13(
        "div",
        { className: "pw-banner pw-error", role: "alert" },
        h13(ErrorDetails, { error: readError, t, showRaw: false }),
        h13("button", { className: "pw-button", onClick: load }, t("retryRead"))
      ),
      arch?.exists ? h13(
        import_react13.default.Fragment,
        null,
        h13("iframe", { className: "pw-arch-frame", title: t("archTitle"), srcDoc: arch.html, sandbox: "allow-scripts allow-same-origin" }),
        h13(
          "section",
          { className: "pw-evidence", "aria-label": t("wikiEvidence") },
          h13("span", { className: "pw-label" }, t("wikiEvidence")),
          (arch.sources ?? []).length ? arch.sources.map((ref, index) => h13("button", {
            key: index,
            className: "pw-refchip pw-reflink",
            title: t("sourceOpen"),
            onClick: () => openSource(ref)
          }, ref.label ? ref.label + " \xB7 " : "", ref.path, ref.from ? `#L${ref.from}${ref.to > ref.from ? `-L${ref.to}` : ""}` : "")) : h13("p", { className: "pw-note" }, t("wikiNoEvidence"))
        )
      ) : !readError && h13("div", { className: "pw-init" }, h13("h2", null, t("archTitle")), h13("p", { className: "pw-note" }, t(arch ? "archEmpty" : "loading"))),
      source && h13(
        Modal,
        {
          title: source.path + (source.from ? ` \xB7 L${source.from}${source.to > source.from ? `\u2013L${source.to}` : ""}` : ""),
          wide: true,
          onClose: closeSource,
          actions: [
            source.error && h13("button", { className: "pw-button", onClick: () => openSource(source) }, t("retry")),
            h13("button", { className: "pw-button primary", onClick: closeSource }, t("ok"))
          ]
        },
        source.loading && h13("p", { className: "pw-note" }, t("loading")),
        source.error && h13("p", { className: "pw-error" }, t("sourceUnavailable")),
        source.content != null && h13("pre", { className: "pw-source-view" }, source.content)
      )
    );
  }

  // client-src/pages/sync.js
  var import_react14 = __toESM(__require("react"), 1);
  var h14 = import_react14.default.createElement;
  var { useCallback: useCallback2, useEffect: useEffect6, useRef: useRef4, useState: useState7 } = import_react14.default;
  var STATES = ["todo", "doing", "blocked", "in_review", "done", "cancelled", "backlog", "reviewing", "ready", "in_progress", "pending", "completed"];
  function SyncView({ root, sessionId, t, refresh, requirements = [], onLocateProposal }) {
    const [list, setList] = useState7(null);
    const [baseline, setBaseline] = useState7(null);
    const [run, setRun] = useState7(null);
    const [loadError, setLoadError] = useState7(null);
    const poll = useRef4(null);
    const mounted = useRef4(false);
    const load = useCallback2(async () => {
      const res = await rpc("sync/proposals", { root });
      if (!mounted.current) return;
      setLoadError(res.ok ? null : res);
      if (res.ok) {
        setList(res.data.proposals.filter((p) => p.status === "pending"));
        setBaseline(res.data.baseline);
      }
    }, [root]);
    useEffect6(() => {
      mounted.current = true;
      load();
      return () => {
        mounted.current = false;
        clearInterval(poll.current);
      };
    }, [load]);
    const canApply = (proposal) => {
      const { kind, suggested_patch: patch } = proposal;
      return !isRequirementSplit(proposal) && !patch?.to && (["req_draft", "new_task", "field_draft"].includes(kind) || kind === "task_suggestion" && patch?.action === "scope");
    };
    const content = (list ?? []).filter((p) => canApply(p) && (p.kind !== "new_task" || taskOverview(p.suggested_patch)));
    const sourceLabel = (source) => {
      if (typeof source !== "string") return "";
      if (source.startsWith("session://")) return t("syncSourceConversation");
      if (source.startsWith("draft://")) return t("syncSourceDraft");
      if (source.startsWith("repo://")) return source.slice("repo://".length);
      if (source.startsWith("wiki:")) return source.slice("wiki:".length);
      const revision = source.match(/^commit:([a-f0-9]{7,40})$/i)?.[1];
      return revision ? t("syncSourceCommit").replace("{revision}", revision.slice(0, 7)) : "";
    };
    const startSync = async () => {
      if (run?.busy) return;
      setRun({ busy: true, message: t("syncRunning") });
      const res = await fetch("/api/project-workbench/sync-run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root, sessionId }) }).then((r) => r.json()).catch(() => null);
      if (!mounted.current) return;
      if (!res?.ok) {
        setRun({ busy: false, message: generationStartMessage(res, "syncRunFailed", t) });
        return;
      }
      clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const st = await fetch("/api/project-workbench/sync-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ root }) }).then((r) => r.json()).catch(() => null);
        if (!mounted.current) return;
        const s = st?.data?.status;
        if (s === "done" || s === "idle") {
          clearInterval(poll.current);
          const produced = st?.data?.produced ?? 0;
          const saved = st?.data?.saved ?? 0;
          const msg = produced === 0 ? t("syncNone") : `${t("syncDone")} ${t("syncSaved").replace("{n}", String(saved))}`;
          setRun({ busy: false, message: msg });
          load();
        } else if (s === "failed" || !st?.ok) {
          clearInterval(poll.current);
          setRun({ busy: false, message: t(s === "failed" ? "syncRunFailed" : "generationStatusUnavailable") });
        }
      }, 4e3);
    };
    const decide = async (p, approve, patch) => {
      if (run?.busy || approve && !canApply(p)) return;
      setRun({ busy: true });
      const res = await rpc(approve ? "sync/apply" : "sync/dismiss", { root, proposalId: p.id, patch, reason: approve ? void 0 : "dismissed in queue" });
      if (!mounted.current) return;
      if (!res.ok) {
        setRun({ busy: false, error: res });
        return;
      }
      await load();
      setRun(null);
      refresh();
    };
    const approveAll = async () => {
      if (run?.busy || !content.length) return;
      setRun({ busy: true, message: t("syncAdoptContent") });
      let ok = 0;
      let fail = 0;
      for (const p of content) {
        const res = await rpc("sync/apply", { root, proposalId: p.id });
        if (res.ok) ok++;
        else fail++;
      }
      if (!mounted.current) return;
      await load();
      setRun({ busy: false, message: t("syncBatchResult").replace("{adopted}", String(ok)).replace("{failed}", String(fail)) });
      refresh();
    };
    const total = (baseline?.accepted ?? 0) + (baseline?.dismissed ?? 0);
    const rate = total > 0 ? Math.round((baseline?.accepted ?? 0) / total * 100) : 0;
    return h14(
      "div",
      { className: "pw-sync" },
      h14(
        "div",
        { className: "pw-banner", role: "status" },
        h14("button", { className: "pw-button primary", onClick: startSync, disabled: run?.busy }, t("syncRun")),
        content.length > 0 && h14("button", { className: "pw-button", onClick: approveAll, disabled: run?.busy }, t("syncAdoptContent")),
        list && h14("span", { className: "pw-count", style: { marginLeft: 8 } }, t("syncPending").replace("{n}", String(list.length))),
        baseline && total > 0 && h14("span", { className: "pw-count", style: { marginLeft: 8 } }, t("syncAcceptRate").replace("{rate}", String(rate)).replace("{accepted}", String(baseline.accepted ?? 0)).replace("{total}", String(total))),
        run?.message && h14("span", { style: { marginLeft: 10 } }, run.message),
        run?.error && h14(ErrorDetails, { error: run.error, t, showRaw: false })
      ),
      loadError && h14(
        "div",
        { className: "pw-banner pw-error", role: "alert" },
        h14(ErrorDetails, { error: loadError, t, showRaw: false }),
        h14("button", { className: "pw-button", onClick: load }, t("retryRead"))
      ),
      !list ? !loadError && h14("div", { className: "pw-empty" }, t("loading")) : list.length === 0 ? h14("div", { className: "pw-empty" }, t("syncEmpty")) : h14("div", { className: "pw-sync-list" }, list.map((p) => {
        const req = requirements.find((req2) => req2.id === p.target?.reqId);
        const task = req?.issues?.find((task2) => task2.id === p.target.issueId);
        const state = p.kind === "task_suggestion" && p.suggested_patch?.action === "cancel" ? "cancelled" : p.suggested_patch?.to;
        const stateLabel = (p.target?.issueId ? "st_" : "col_") + state;
        const sources = [...new Set((p.evidence ?? []).map(sourceLabel).filter(Boolean))];
        const split = isRequirementSplit(p);
        return h14(
          "div",
          { key: p.id, className: "pw-proposal" },
          h14(
            "div",
            { className: "pw-proposal-head" },
            h14("span", { className: "pw-istatus st-doing" }, t("kind_" + p.kind)),
            h14("strong", null, task?.title ?? req?.title ?? t(p.target?.issueId ? "issueDetail" : "detail")),
            STATES.includes(state) && h14("span", { className: "pw-count" }, "\u2192 ", t(stateLabel))
          ),
          (p.kind !== "new_task" || split) && h14("div", { className: "pw-proposal-reason" }, split ? p.suggested_patch?.title : p.reason),
          sources.length > 0 && h14(
            "div",
            { className: "pw-proposal-evidence" },
            h14("span", { className: "pw-label" }, t("syncEvidence")),
            sources.map((source) => h14("span", { key: source, className: "pw-refchip" }, source))
          ),
          p.kind === "new_task" && canApply(p) ? h14(DraftSuggestions, {
            proposals: [p],
            root,
            t,
            busy: run?.busy,
            act: (method, input) => decide(p, method === "proposal/adopt", input.patch)
          }) : h14(
            "div",
            { className: "pw-actions" },
            canApply(p) ? h14("button", { className: "pw-button primary", onClick: () => decide(p, true), disabled: run?.busy }, t("demoAdopt")) : p.target?.reqId && h14(
              "button",
              { className: "pw-button", onClick: () => onLocateProposal({ ...p.target, split }) },
              t(split ? "splitLocate" : p.target.issueId ? "syncLocateTask" : "syncLocateRequirement")
            ),
            !split && h14("button", { className: "pw-button", onClick: () => decide(p, false), disabled: run?.busy }, t("syncDismiss"))
          )
        );
      }))
    );
  }

  // client-src/detail/requirement-detail.js
  var import_react15 = __toESM(__require("react"), 1);
  var h15 = import_react15.default.createElement;
  var { useCallback: useCallback3, useEffect: useEffect7, useRef: useRef5, useState: useState8 } = import_react15.default;
  function PrdDocuments({ root, reqId, initialId, t }) {
    const [items, setItems] = useState8([]);
    const [show, setShow] = useState8(initialId ?? null);
    const [content, setContent] = useState8(null);
    const [error, setError] = useState8(null);
    const [retry, setRetry] = useState8(0);
    useEffect7(() => {
      let active = true;
      rpc("prd/list", { root, reqId }).then((res) => {
        if (!active) return;
        if (res.ok) setItems(res.data);
        else setError(res.message);
      });
      return () => {
        active = false;
      };
    }, [root, reqId, retry]);
    useEffect7(() => {
      let active = true;
      setContent(null);
      if (show) rpc("prd/read", { root, id: show }).then((res) => {
        if (!active) return;
        if (res.ok) setContent(res.data.markdown);
        else setError(res.message);
      });
      return () => {
        active = false;
      };
    }, [root, show, retry]);
    if (!items.length && !error) return null;
    return h15(
      "section",
      { className: "pw-result", "aria-label": t("prds") },
      h15("strong", null, t("prds")),
      h15("div", { className: "pw-actions" }, items.map((item) => h15("button", {
        key: item.id,
        type: "button",
        className: "pw-button",
        "aria-expanded": item.id === show,
        onClick: () => {
          setError(null);
          setShow(show === item.id ? null : item.id);
        }
      }, item.title))),
      error && h15("p", { role: "alert" }, error, " ", h15("button", {
        type: "button",
        className: "pw-button",
        onClick: () => {
          setError(null);
          setRetry((n) => n + 1);
        }
      }, t("pwbRetry"))),
      show && content && h15("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, content)
    );
  }
  function useWorkItemDraft(draftKey, item, fieldsOf, onDirty, memory) {
    const [editing, setEditing] = useState8(() => !!memory.drafts[draftKey]);
    const [draft, setDraft] = useState8(() => draftOf(memory.drafts, draftKey, fieldsOf(item)));
    const base = useRef5({ fields: fieldsOf(item), fileHash: item.hash });
    useEffect7(() => {
      onDirty?.(!!memory.drafts[draftKey]);
    }, [draftKey, onDirty]);
    const begin = () => {
      base.current = { fields: fieldsOf(item), fileHash: item.hash };
      setDraft(base.current.fields);
      setEditing(true);
    };
    const change = (key, value) => {
      const next = { ...draft, [key]: value };
      const dirty = !sameDraft(next, base.current.fields);
      setDraft(next);
      if (dirty) memory.drafts[draftKey] = { fields: next, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash };
      else delete memory.drafts[draftKey];
      onDirty?.(dirty);
    };
    const finish = () => {
      delete memory.drafts[draftKey];
      setEditing(false);
      onDirty?.(false);
    };
    const params = () => ({ patch: draft, fileHash: memory.drafts[draftKey]?.fileHash ?? base.current.fileHash });
    return { editing, begin, finish, params, draft, change };
  }
  function IssueStatusSelect({ req, issue, t, moveIssue, busy }) {
    const statusText = t("st_" + issue.status);
    const moves = Object.entries(ISSUE_MOVES[issue.status] ?? {});
    if (req.status !== "in_progress" || req.pendingReopen || !moves.length) {
      return h15("span", { className: "pw-istatus st-" + issue.status }, statusText);
    }
    return h15(
      "select",
      {
        className: "pw-select",
        value: issue.status,
        disabled: busy,
        "aria-label": `${issue.title} \xB7 ${statusText}`,
        onChange: (e) => moveIssue(req, issue, e.target.value)
      },
      h15("option", { value: issue.status, disabled: true }, statusText),
      moves.map(([status, label]) => h15("option", { key: status, value: status }, t(label)))
    );
  }
  var splitLabels = { verified: "splitVerified", assigned: "splitAssigned", gap: "splitGap", unknown: "splitUnknown" };
  function TaskSuggestionReview({ review, req, t, onOpenIssue, hasDrafts, hasLegacy, pending, error, readError, reload, onReview, feedback, changeFeedback, refining, showFeedback }) {
    if (!review && !hasDrafts && !hasLegacy && !pending && !error && !readError && !refining) return null;
    const items = review?.items ?? [];
    const counts = Object.entries(splitLabels).flatMap(([status, label]) => {
      const count = items.filter((item) => item.status === status).length;
      return count ? [t(label) + " " + count] : [];
    });
    const unresolved = items.find((item) => item.status === "gap") ?? items.find((item) => item.status === "unknown");
    const assigned = items.find((item) => item.status === "assigned" && item.needsWork && item.taskIds?.length) ?? items.find((item) => item.status === "assigned" && item.taskIds?.length);
    const taskLinks = (item) => h15("div", { className: "pw-actions" }, item.taskIds?.map((id) => {
      const task = req.issues?.find((task2) => task2.id === id);
      if (!task) return null;
      return h15(
        "button",
        { key: id, type: "button", className: "pw-button", onClick: () => onOpenIssue(id) },
        task.title,
        " \xB7 ",
        t("st_" + task.status)
      );
    }));
    return h15(
      "section",
      { className: "pw-result", "aria-label": t("splitReview"), "aria-busy": pending },
      h15("strong", null, t("splitReview")),
      pending && h15("p", { className: "pw-text", role: "status" }, t("splitWorking")),
      counts.length > 0 && h15("p", { className: "pw-text" }, counts.join(" \xB7 ")),
      unresolved && h15(
        import_react15.default.Fragment,
        null,
        h15(ReadText, { value: unresolved.detail, preview: true }),
        unresolved.taskIds?.length > 0 && taskLinks(unresolved)
      ),
      assigned && h15(
        import_react15.default.Fragment,
        null,
        h15(ReadText, { value: assigned.detail, preview: true }),
        taskLinks(assigned)
      ),
      review?.question && h15(ReadText, { value: review.question }),
      review && !hasDrafts && h15(
        "p",
        { className: "pw-text" },
        t(items.length && !review.question && items.every((item) => ["verified", "assigned"].includes(item.status)) ? "splitNoNew" : "splitNoDrafts")
      ),
      items.length > 0 && h15(
        Disclosure,
        { label: t("splitDetails") },
        h15("ul", { className: "pw-reading-list" }, items.map((item) => h15(
          "li",
          { key: item.id },
          h15("strong", null, t(splitLabels[item.status]), " \xB7 ", item.requirement),
          h15(ReadText, { value: item.detail }),
          item.taskIds?.length > 0 && taskLinks(item),
          item.sources?.map((source) => h15(
            "div",
            { key: source.path + source.quote, className: "pw-note" },
            h15("span", null, source.path),
            h15(ReadText, { value: source.quote })
          ))
        )))
      ),
      hasLegacy && !review && h15("p", { className: "pw-text" }, t("splitOld")),
      h15(ErrorDetails, { error: error ?? readError, t, showRaw: false }),
      readError && h15("button", { type: "button", className: "pw-button pw-quiet", disabled: pending, onClick: reload }, t("retryRead")),
      refining ? h15(
        "form",
        { className: "pw-progress-form", onSubmit: (event) => {
          event.preventDefault();
          if (!pending && feedback.trim()) onReview(feedback);
        } },
        h15(
          "label",
          { className: "pw-field" },
          h15("span", { className: "pw-label" }, t("splitFeedback")),
          h15("input", {
            type: "text",
            className: "pw-input",
            autoFocus: true,
            value: feedback,
            disabled: pending,
            placeholder: t("splitFeedbackHint"),
            onChange: (event) => changeFeedback(event.target.value)
          })
        ),
        h15(
          "div",
          { className: "pw-actions" },
          h15("button", { type: "submit", className: "pw-button", disabled: pending || !feedback.trim() }, t("splitRethink")),
          h15("button", { type: "button", className: "pw-button pw-quiet", disabled: pending, onClick: () => showFeedback(false) }, t("cancel"))
        )
      ) : h15(
        "div",
        { className: "pw-actions" },
        (review || hasDrafts) && h15("button", { type: "button", className: "pw-button pw-quiet", disabled: pending, onClick: () => showFeedback(true) }, t("splitRethink")),
        (hasLegacy || error) && h15("button", { type: "button", className: "pw-button pw-quiet", disabled: pending, onClick: () => onReview() }, t("splitRetry"))
      )
    );
  }
  function DetailPanel({ req, t, root, mutate, moveIssue, onDelete, onOpenIssue, onCreateTask, projectKey, rootRef, onDirty, busy, sessionId, setModal, uiMemory: uiMemory2, onReorderTask, onStartTask }) {
    const form = useWorkItemDraft(reqDraftKey(projectKey, req.id), req, reqDraftFrom, onDirty, uiMemory2);
    const [attempted, setAttempted] = useState8(false);
    const [proposals, setProposals] = useState8([]);
    const remembered = uiMemory2.taskReviews[reqDraftKey(projectKey, req.id)] ??= { edits: {} };
    const [split, setSplit] = useState8(() => remembered.result ?? null);
    const [feedback, setFeedback] = useState8(() => remembered.feedback ?? "");
    const [refining, setRefining] = useState8(() => !!remembered.refining);
    const [splitBusy, setSplitBusy] = useState8(false);
    const [splitError, setSplitError] = useState8(null);
    const [readError, setReadError] = useState8(null);
    const live = useRef5(false);
    const proposalSeq = useRef5(0);
    const mode = req.status === "backlog" ? "organize" : req.status === "in_progress" ? "split" : null;
    const loadProposals = useCallback3(async () => {
      const seq = ++proposalSeq.current;
      if (!mode) return;
      const res = await rpc("proposal/list", { root });
      if (!live.current || seq !== proposalSeq.current) return;
      setReadError(res.ok ? null : res);
      if (res.ok) setProposals(res.data.proposals.filter((p) => p.status === "pending" && p.target.reqId === req.id && p.kind === (mode === "organize" ? "req_draft" : "new_task")));
    }, [root, req.id, mode]);
    useEffect7(() => {
      live.current = true;
      loadProposals();
      return () => {
        live.current = false;
      };
    }, [loadProposals]);
    const actProposal = async (method, input) => {
      const res = await mutate(method, input);
      if (res.ok) await loadProposals();
      return res;
    };
    const splitProposals = mode === "split" ? proposals.filter(isRequirementSplit) : [];
    const splitDrafts = splitProposals.filter((proposal) => proposal.split && (!split || split.proposalIds.includes(proposal.id)));
    const changeFeedback = (text) => {
      remembered.feedback = text;
      setFeedback(text);
    };
    const showFeedback = (open) => {
      remembered.refining = open;
      setRefining(open);
    };
    const suggestSplit = async (note) => {
      if (busy || splitBusy) return;
      setSplitBusy(true);
      setSplitError(null);
      const res = await mutate("requirement/split", {
        root,
        id: req.id,
        sessionId,
        feedback: note?.trim(),
        priorProposalIds: splitProposals.map((proposal) => proposal.id)
      }, { inlineError: true });
      if (res?.ok) {
        remembered.result = res.data;
        remembered.feedback = "";
        remembered.refining = false;
        remembered.edits = {};
      }
      if (!live.current) return;
      if (res?.ok) {
        setSplit(res.data);
        changeFeedback("");
        showFeedback(false);
        await loadProposals();
      } else setSplitError(res);
      setSplitBusy(false);
    };
    const actSplit = async (method, input) => {
      const res = await mutate(method, { ...input, reqId: req.id }, { inlineError: true });
      if (res?.ok) {
        delete remembered.edits[input.proposalId];
        const result = remembered.result;
        const proposal = splitDrafts.find((proposal2) => proposal2.id === input.proposalId);
        if (method === "proposal/adopt" && res.data?.id && proposal && result?.proposalIds.includes(proposal.id)) {
          const covered = new Set(proposal.split.requirements.map((requirement) => requirement.id));
          const { id, reused } = res.data;
          const items = result.review.items.map((item) => covered.has(item.id) && item.status === "gap" ? {
            ...item,
            status: reused ? "unknown" : "assigned",
            detail: t(reused ? "splitCheckSameTitle" : "splitNowAssigned"),
            taskIds: [id]
          } : item);
          const question = items.some((item) => item.status === "gap" || item.status === "unknown") ? result.review.question : "";
          remembered.result = { ...result, review: { items, question } };
        }
      }
      if (!live.current) return res;
      if (res?.ok) {
        if (remembered.result) setSplit(remembered.result);
        setProposals((previous) => previous.filter((proposal) => proposal.id !== input.proposalId));
        setSplitError(null);
        await loadProposals();
      } else setSplitError(res);
      return res;
    };
    const save = async (extra = {}, inlineError = false) => {
      const res = await mutate("requirement/update", { root, id: req.id, ...form.params(), ...extra }, { inlineError });
      if (res.ok && rootRef.current === root && live.current) form.finish();
      return res;
    };
    const saveForm = () => {
      setAttempted(true);
      if (busy || requirementFormError(form.draft)) return;
      const changedReviewed = ["ready", "in_progress"].includes(req.status) && changesReviewedRequirement(req, form.draft);
      if (!changedReviewed) return save();
      setModal({
        kind: "reason",
        title: t("confirmReviewEdit"),
        body: t("confirmReviewEditBody"),
        onOk: (reason) => save({ confirmReviewInvalid: true, reason }, true)
      });
    };
    const canEdit = !req.pendingReopen && !["pending", "completed"].includes(req.status);
    const editing = form.editing && canEdit;
    const tasks = req.issues ?? [];
    const canDelete = req.status === "backlog" && !tasks.length && !req.devHistory;
    const organize = () => actProposal("requirement/organize", { root, id: req.id, sessionId });
    const drafts = mode && h15(DraftSuggestions, { proposals: proposals.filter((proposal) => !isRequirementSplit(proposal)), act: actProposal, root, t, busy });
    return h15(
      import_react15.default.Fragment,
      null,
      h15(
        "section",
        { className: editing ? "pw-subpage" : "pw-subpage pw-read-card", "aria-label": t("detail") },
        h15(
          "header",
          { className: "pw-subpage-head" },
          h15(
            "div",
            { className: "pw-read-title" },
            h15("h2", null, req.title),
            h15("span", { className: "pw-count pw-read-status", "data-status": req.status }, t("col_" + req.status))
          ),
          !form.editing && h15(
            "div",
            { className: "pw-actions" },
            canEdit && h15("button", { className: "pw-button", onClick: () => {
              setAttempted(false);
              form.begin();
            } }, t("edit")),
            req.status === "backlog" && h15(
              "details",
              { className: "pw-disclosure pw-detail-more" },
              h15("summary", null, t("requirementActions")),
              h15(
                "div",
                { className: "pw-actions" },
                h15("button", { className: "pw-button", disabled: busy, onClick: organize }, t("aiOrganize")),
                canDelete && h15("button", { className: "pw-button danger", disabled: busy, onClick: onDelete }, t("delete"))
              )
            )
          )
        ),
        editing ? h15(
          "form",
          { noValidate: true, onSubmit: (e) => {
            e.preventDefault();
            saveForm();
          } },
          h15(RequirementFields, { form, t, busy, req }),
          attempted && h15(ErrorDetails, { error: requirementFormError(form.draft), t, showRaw: false }),
          h15(
            "div",
            { className: "pw-actions" },
            h15("button", { type: "submit", className: "pw-button primary", disabled: busy }, t("save")),
            h15("button", { type: "button", className: "pw-button", disabled: busy, onClick: form.finish }, t("cancel"))
          )
        ) : h15(
          import_react15.default.Fragment,
          null,
          h15(RequirementOverview, { req, t }),
          mode === "organize" && drafts
        )
      ),
      h15(
        IssueSidebar,
        {
          req,
          t,
          moveIssue,
          onOpenIssue,
          onCreateTask,
          busy,
          onReorderTask,
          onStartTask,
          onSuggest: mode === "split" && !editing ? () => suggestSplit() : void 0,
          suggestionReview: mode === "split" && !req.pendingReopen && !editing && h15(TaskSuggestionReview, {
            review: split?.review,
            req,
            t,
            onOpenIssue,
            hasDrafts: !!splitDrafts.length,
            hasLegacy: splitProposals.some((proposal) => !proposal.split),
            pending: splitBusy,
            error: splitError,
            readError,
            reload: loadProposals,
            onReview: suggestSplit,
            feedback,
            changeFeedback,
            refining,
            showFeedback
          })
        },
        mode === "split" && !req.pendingReopen && !editing && h15(
          import_react15.default.Fragment,
          null,
          h15(DraftSuggestions, {
            key: split?.proposalIds?.join(",") ?? "",
            proposals: splitDrafts,
            act: actSplit,
            root,
            t,
            busy: busy || splitBusy,
            adoptDisabled: ["ASSIST_STALE", "DRAFT_STALE"].includes(splitError?.code),
            rememberEdits: remembered.edits
          }),
          drafts
        )
      ),
      h15(RequirementHistory, { req, t, onAdd: canEdit && !req.pendingReopen ? (text) => mutate("requirement/addUpdate", { root, id: req.id, text }) : void 0 })
    );
  }
  function IssueSidebar({ req, t, moveIssue, onOpenIssue, onCreateTask, busy, onSuggest, onReorderTask, onStartTask, suggestionReview, children }) {
    const locked = req.status !== "in_progress" || !!req.pendingReopen;
    const tasks = sortedTasks(req.issues);
    return h15(
      "section",
      { className: "pw-issues pw-issue-list", "aria-label": t("issues") },
      h15(
        "div",
        { className: "pw-colhead" },
        h15("strong", null, t("issues")),
        h15("span", { className: "pw-count" }, String(tasks.length)),
        !locked && h15(
          "div",
          { className: "pw-actions", style: { marginInlineStart: "auto" } },
          h15("button", { className: "pw-button", disabled: busy, onClick: onCreateTask }, t("newTask")),
          onSuggest && h15("button", { id: "pw-suggest-" + req.id, className: "pw-button", disabled: busy, onClick: onSuggest }, t("aiSplit"))
        )
      ),
      suggestionReview,
      tasks.map((i, index) => h15(
        "div",
        { key: i.id, className: "pw-issue" },
        !locked && h15(
          "span",
          { className: "pw-order" },
          h15("button", { className: "pw-orderbtn", disabled: busy || index === 0, "aria-label": t("moveUp"), title: t("moveUp"), onClick: () => onReorderTask(i.id, "up") }, "\u2191"),
          h15("button", { className: "pw-orderbtn", disabled: busy || index === tasks.length - 1, "aria-label": t("moveDown"), title: t("moveDown"), onClick: () => onReorderTask(i.id, "down") }, "\u2193")
        ),
        h15(
          "button",
          { id: "pw-task-" + i.id, className: "pw-issue-title", onClick: () => onOpenIssue(i.id), title: i.title },
          h15("span", { className: "pw-preview" }, i.title),
          h15("span", { "aria-hidden": true }, "\u203A")
        ),
        h15(IssueStatusSelect, { req, issue: i, t, moveIssue, busy }),
        !locked && onStartTask && ["todo", "doing", "blocked"].includes(i.status) && h15(
          "button",
          { className: "pw-button pw-quiet pw-startbtn", disabled: busy, onClick: () => onStartTask(i.id) },
          t(i.status === "todo" ? "startTask" : "demoContinue")
        )
      )),
      children
    );
  }

  // client-src/detail/task-detail.js
  var import_react17 = __toESM(__require("react"), 1);

  // client-src/detail/acceptance-assist.js
  var import_react16 = __toESM(__require("react"), 1);
  var h16 = import_react16.default.createElement;
  var { useEffect: useEffect8, useRef: useRef6, useState: useState9 } = import_react16.default;
  var acceptanceAssistLocale = {
    zh: {
      acceptanceHelp: "\u4EFB\u52A1\u9A8C\u6536\u8F85\u52A9",
      acceptanceVerify: "AI \u8F85\u52A9\u9A8C\u6536",
      acceptanceGuide: "\u751F\u6210\u5B9E\u64CD\u9A8C\u6536\u6B65\u9AA4",
      acceptanceHelpDetails: "\u4F7F\u7528\u8BF4\u660E",
      acceptanceCheckReport: "\u67E5\u770B AI \u9A8C\u6536\u62A5\u544A",
      acceptanceGuideSteps: "\u5B9E\u64CD\u9A8C\u6536\u6B65\u9AA4",
      acceptanceGuideExpected: "\u6B63\u5E38\u5E94\u770B\u5230",
      acceptanceGuideNotNeeded: "\u65E0\u9700\u5B9E\u64CD\u3002\u8BF7\u6309\u4EFB\u52A1\u5B8C\u6210\u6807\u51C6\u6838\u5BF9\u6D4B\u8BD5\u548C\u9A8C\u8BC1\u8BB0\u5F55\u3002",
      acceptanceGuideUnknown: "\u6682\u672A\u627E\u5230\u53EF\u6838\u5BF9\u7684\u7528\u6237\u64CD\u4F5C\u5165\u53E3\u3002",
      acceptanceRunHint: "AI \u9A8C\u6536\u4F1A\u5C1D\u8BD5\u8FD0\u884C\u68C0\u67E5\u547D\u4EE4\uFF0C\u53EF\u80FD\u6D88\u8017\u6A21\u578B\u989D\u5EA6\u3002",
      acceptanceVerifyNotice: "AI \u4F1A\u5C1D\u8BD5\u8FD0\u884C\u5B9E\u9645\u68C0\u67E5\u547D\u4EE4\uFF0C\u53EF\u80FD\u6D88\u8017\u6A21\u578B\u989D\u5EA6\uFF1B\u6587\u4EF6\u53EA\u8BFB\u4E0D\u4EE3\u8868\u5916\u90E8\u670D\u52A1\u6216\u73AF\u5883\u9694\u79BB\u3002\u8BF7\u5148\u786E\u8BA4\u9002\u5408\u5728\u5F53\u524D\u9879\u76EE\u8FD0\u884C\u3002",
      acceptanceGuideNotice: "\u5B9E\u64CD\u6B65\u9AA4\u7531 AI \u8D77\u8349\uFF0C\u8BF7\u5148\u6838\u5BF9\u9879\u76EE\u5B9E\u9645\u5165\u53E3\u3002\u53D1\u73B0\u5F02\u5E38\u53EF\u5728\u4EFB\u52A1\u7684\u4FEE\u6539\u539F\u56E0\u4E2D\u53CD\u9988\u3002",
      acceptanceHelpRunning: "\u6B63\u5728\u5904\u7406\uFF0C\u8BF7\u7A0D\u5019\u2026",
      acceptanceHelpError: "\u9A8C\u6536\u8F85\u52A9\u672A\u5B8C\u6210",
      acceptanceReport: "AI \u8BF4\u660E\uFF08\u9700\u81EA\u884C\u6838\u5BF9\uFF09",
      acceptanceNoReport: "\u6CA1\u6709\u6536\u5230\u53EF\u7528\u8BF4\u660E\u3002",
      acceptanceCommands: "\u5B9E\u9645\u547D\u4EE4\u8BB0\u5F55",
      acceptanceNoCommands: "\u672C\u6B21\u6CA1\u6709\u8BB0\u5F55\u5B9E\u9645\u6267\u884C\u7684\u547D\u4EE4\uFF0C\u4E0D\u80FD\u636E\u6B64\u8BA4\u4E3A\u6D4B\u8BD5\u5DF2\u8FD0\u884C\u3002",
      acceptanceCommandsUnavailable: "\u65E0\u6CD5\u8BFB\u53D6\u672C\u6B21\u6267\u884C\u8BB0\u5F55\uFF0C\u4E0D\u80FD\u5224\u65AD\u547D\u4EE4\u662F\u5426\u8FD0\u884C\uFF1B\u8BF7\u67E5\u770B\u5BF9\u5E94\u5B50\u4F1A\u8BDD\u3002",
      acceptanceCommand: "\u547D\u4EE4",
      acceptanceOutcome: "\u6267\u884C\u7ED3\u679C",
      acceptanceOutput: "\u5B9E\u9645\u8F93\u51FA\u6458\u5F55",
      acceptanceCommandOk: "\u547D\u4EE4\u6267\u884C\u6210\u529F",
      acceptanceCommandPending: "\u5C1A\u672A\u7ED3\u675F",
      acceptanceCommandTimeout: "\u6267\u884C\u8D85\u65F6\uFF0C\u672A\u5B8C\u6210",
      acceptanceCommandError: "\u547D\u4EE4\u6267\u884C\u51FA\u9519",
      acceptanceCommandStopped: "\u6267\u884C\u5DF2\u4E2D\u6B62\uFF0C\u672A\u5B8C\u6210",
      acceptanceCommandFailed: "\u547D\u4EE4\u6267\u884C\u5931\u8D25",
      acceptanceCommandUnknown: "\u6267\u884C\u72B6\u6001\u672A\u77E5",
      acceptanceTestConclusion: "\u6D4B\u8BD5\u7ED3\u8BBA",
      acceptanceTestPassed: "\u6D4B\u8BD5\u901A\u8FC7",
      acceptanceTestFailed: "\u6D4B\u8BD5\u5931\u8D25",
      acceptanceTestUnknown: "\u672A\u6838\u5B9E",
      acceptanceTestSummary: "\u6D4B\u8BD5\u6458\u8981",
      acceptanceUnknown: "\u672A\u8BB0\u5F55",
      acceptanceNoOutput: "\u672A\u8BB0\u5F55\u8F93\u51FA",
      acceptanceStale: "\u9700\u6C42\u3001\u4EFB\u52A1\u6216\u4F1A\u8BDD\u5173\u8054\u53EF\u80FD\u53D8\u5316\uFF0C\u6216\u72B6\u6001\u65E0\u6CD5\u6838\u5BF9\uFF1B\u6B64\u7ED3\u679C\u53EF\u80FD\u8FC7\u65F6\uFF0C\u8BF7\u91CD\u65B0\u6838\u5BF9\u3002",
      acceptanceRetryStale: "\u8FD9\u662F\u4E0A\u4E00\u6B21\u7ED3\u679C\uFF0C\u672C\u6B21\u91CD\u65B0\u6838\u5BF9\u5C1A\u672A\u6210\u529F\uFF0C\u8BF7\u52FF\u5F53\u4F5C\u672C\u6B21\u7ED3\u679C\u3002",
      acceptanceSourceLimit: "\u6B64\u7ED3\u679C\u53EA\u68C0\u67E5\u9700\u6C42\u548C\u4EFB\u52A1\u8BB0\u5F55\u662F\u5426\u53D8\u5316\uFF0C\u4E0D\u68C0\u67E5\u9879\u76EE\u6E90\u7801\u662F\u5426\u53D8\u5316\uFF0C\u8BF7\u7ED3\u5408\u5F53\u524D\u9879\u76EE\u6838\u5BF9\u3002",
      acceptanceSession: "\u5B50\u4F1A\u8BDD\u8BB0\u5F55",
      acceptanceOutputLimit: "\u8F93\u51FA\u53EA\u663E\u793A\u6458\u5F55\uFF0C\u5B8C\u6574\u8BB0\u5F55\u8BF7\u67E5\u770B\u5BF9\u5E94\u5B50\u4F1A\u8BDD\u3002",
      acceptanceSources: "\u6838\u5BF9\u5230\u7684\u8D44\u6599\u539F\u6587",
      acceptanceSourcesInsufficient: "\u53EF\u6838\u5BF9\u7684\u8D44\u6599\u4E0D\u8DB3\uFF0C\u8BF7\u5148\u786E\u8BA4\u5B9E\u9645\u5165\u53E3\u548C\u6B65\u9AA4\u3002",
      acceptanceSourcesScope: "\u8FD9\u91CC\u53EA\u6838\u5BF9\u4E86\u5F15\u7528\u539F\u6587\u662F\u5426\u5B58\u5728\uFF0C\u4E0D\u4EE3\u8868\u64CD\u4F5C\u6B65\u9AA4\u4E00\u5B9A\u6B63\u786E\u3002",
      acceptanceStayOpen: "\u672C\u7A97\u53E3\u5185\u53EF\u79BB\u5F00\u540E\u8FD4\u56DE\u67E5\u770B\uFF1B\u91CD\u8F7D\u63D2\u4EF6\u540E\uFF0C\u672C\u9875\u7684\u7ED3\u679C\u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u3002"
    },
    en: {
      acceptanceHelp: "Task acceptance assistance",
      acceptanceVerify: "Ask AI to check",
      acceptanceGuide: "Create a hands-on acceptance guide",
      acceptanceHelpDetails: "How it works",
      acceptanceCheckReport: "View the AI check report",
      acceptanceGuideSteps: "Hands-on acceptance steps",
      acceptanceGuideExpected: "Expected result",
      acceptanceGuideNotNeeded: "No hands-on steps needed. Review the tests and verification records against the task criteria.",
      acceptanceGuideUnknown: "No user-facing action could be verified from the available information.",
      acceptanceRunHint: "AI checks may run commands and use model credits.",
      acceptanceVerifyNotice: "AI may run actual check commands and use model credits. Read-only files do not isolate external services or the environment. Make sure it is appropriate to run checks in this project.",
      acceptanceGuideNotice: "Check the project\u2019s actual entry point before following the AI draft. Report problems in the task\u2019s change request.",
      acceptanceHelpRunning: "Working, please wait\u2026",
      acceptanceHelpError: "Acceptance assistance did not complete",
      acceptanceReport: "AI explanation (review it yourself)",
      acceptanceNoReport: "No usable explanation was returned.",
      acceptanceCommands: "Actual command records",
      acceptanceNoCommands: "No executed command was recorded; this does not establish that tests ran.",
      acceptanceCommandsUnavailable: "The execution records could not be read, so whether commands ran is unknown. Check the child conversation.",
      acceptanceCommand: "Command",
      acceptanceOutcome: "Outcome",
      acceptanceOutput: "Actual output excerpt",
      acceptanceCommandOk: "Command completed successfully",
      acceptanceCommandPending: "Not finished",
      acceptanceCommandTimeout: "Timed out; not completed",
      acceptanceCommandError: "Command failed with an error",
      acceptanceCommandStopped: "Stopped; not completed",
      acceptanceCommandFailed: "Command failed",
      acceptanceCommandUnknown: "Command status unknown",
      acceptanceTestConclusion: "Test conclusion",
      acceptanceTestPassed: "Tests passed",
      acceptanceTestFailed: "Tests failed",
      acceptanceTestUnknown: "Not verified",
      acceptanceTestSummary: "Test summary",
      acceptanceUnknown: "Not recorded",
      acceptanceNoOutput: "No output recorded",
      acceptanceStale: "The requirement, task or conversation link may have changed, or its state could not be checked. This result may be out of date.",
      acceptanceRetryStale: "This is the previous result; the current check has not completed successfully.",
      acceptanceSourceLimit: "This only checks for changes to the requirement and task records, not the project source files. Check the current project.",
      acceptanceSession: "Child conversation",
      acceptanceOutputLimit: "Output is an excerpt; see the child conversation for the complete record.",
      acceptanceSources: "Verified source excerpts",
      acceptanceSourcesInsufficient: "There are not enough verifiable sources. Check the actual entry points and steps first.",
      acceptanceSourcesScope: "Only the existence of the quoted text was checked; the steps may still be incorrect.",
      acceptanceStayOpen: "You can leave and return in this window; the result will not automatically return after the plugin reloads."
    }
  };
  function outcomeText(outcome, t) {
    if (outcome === "ok" || outcome === "exit:0") return t("acceptanceCommandOk");
    if (outcome === "background" || outcome === "pending") return t("acceptanceCommandPending");
    if (outcome === "timeout") return t("acceptanceCommandTimeout");
    if (outcome === "error") return t("acceptanceCommandError");
    if (/^(?:signal|stopped):/.test(String(outcome ?? ""))) return t("acceptanceCommandStopped");
    const exit = String(outcome ?? "").match(/^exit:(-?\d+)$/);
    return exit ? `${t("acceptanceCommandFailed")} (${exit[1]})` : t("acceptanceCommandUnknown");
  }
  var notify = (entry) => {
    for (const listener of entry.listeners) listener();
  };
  function AcceptanceAssist({ req, issue, root, sessionId, t, busy = false, onRunningChange, memory, compact = false }) {
    const localMemory = useRef6({});
    const cache = (memory ?? localMemory.current).acceptanceAssist ??= {};
    const entry = cache[JSON.stringify([root, req.id, issue.id])] ??= { pending: "", results: {}, error: null, listeners: /* @__PURE__ */ new Set() };
    const [, redraw] = useState9(0);
    const runningCallback = useRef6(onRunningChange);
    const context = JSON.stringify([req.hash, req.status, issue.hash, issue.status]);
    const reviewable = req.status === "in_progress" && !req.pendingReopen && issue.status === "in_review";
    runningCallback.current = onRunningChange;
    useEffect8(() => {
      const listener = () => {
        redraw((n) => n + 1);
        runningCallback.current?.(!!entry.pending);
      };
      entry.listeners.add(listener);
      runningCallback.current?.(!!entry.pending);
      return () => {
        entry.listeners.delete(listener);
        runningCallback.current?.(false);
      };
    }, [entry]);
    const run = async (kind) => {
      if (entry.pending || busy || !reviewable) return;
      entry.pending = kind;
      entry.error = null;
      if (entry.results[kind]) entry.results[kind] = { ...entry.results[kind], outdated: true };
      notify(entry);
      try {
        const response = await rpc("acceptance/assist", { root, reqId: req.id, issueId: issue.id, sessionId, kind });
        if (!response?.ok) {
          entry.error = { kind, code: response?.code, message: response?.message };
        } else {
          entry.results[kind] = { ...response.data, context };
        }
      } catch (e) {
        entry.error = { kind, message: e instanceof Error ? e.message : String(e) };
      } finally {
        entry.pending = "";
        notify(entry);
      }
    };
    const renderResult = (kind) => {
      const result = entry.results[kind];
      if (!result) return null;
      const stale = !!result.stale || !!result.outdated || result.context !== context || !!(sessionId && result.sessionId && sessionId !== result.sessionId);
      const staleNotice = stale && h16("p", { className: "pw-note", role: "status" }, t(result.outdated ? "acceptanceRetryStale" : "acceptanceStale"));
      if (kind === "guide") {
        if (result.guideStatus !== "steps") return h16(
          import_react16.default.Fragment,
          null,
          staleNotice,
          h16("p", { className: "pw-note", role: "status" }, t(result.guideStatus === "not_needed" ? "acceptanceGuideNotNeeded" : "acceptanceGuideUnknown"))
        );
        const sources = result.sources ?? [];
        return h16(
          "section",
          { className: "pw-reading-block pw-assist-report", "aria-label": t("acceptanceGuideSteps") },
          staleNotice,
          h16("h4", null, t("acceptanceGuideSteps")),
          h16("ol", { className: "pw-reading-list pw-guide-steps" }, result.steps.map(({ action, expected }, index) => h16(
            "li",
            { key: index },
            h16("span", null, action),
            h16("p", { className: "pw-note" }, t("acceptanceGuideExpected"), " \xB7 ", expected)
          ))),
          sources.length < result.sourcesRequested && h16("p", { className: "pw-note" }, t("acceptanceSourcesInsufficient")),
          h16(
            "details",
            { className: "pw-disclosure pw-assist-disclosure" },
            h16("summary", null, t("acceptanceSources")),
            sources.map((source, index) => h16(
              "div",
              { key: index, className: "pw-reading-block" },
              h16("strong", null, source.path),
              h16("p", { className: "pw-text" }, source.quote)
            )),
            h16("p", { className: "pw-note" }, t("acceptanceSourcesScope")),
            h16("p", { className: "pw-note" }, t("acceptanceSourceLimit")),
            result.childId && h16("p", { className: "pw-note" }, t("acceptanceSession"), "\uFF1A", result.childId)
          )
        );
      }
      const commands = Array.isArray(result.commands) ? result.commands : [];
      const report = h16(
        "section",
        { className: "pw-reading-block pw-assist-report", "aria-label": t("acceptanceVerify") },
        !compact && staleNotice,
        h16("p", { className: "pw-note" }, t("acceptanceSourceLimit")),
        h16("h4", null, t("acceptanceReport")),
        h16("p", { className: "pw-text", style: { whiteSpace: "pre-wrap" } }, typeof result.report === "string" && result.report.trim() ? result.report : t("acceptanceNoReport")),
        result.childId && h16("p", { className: "pw-note" }, t("acceptanceSession"), "\uFF1A", result.childId),
        h16("h4", null, t("acceptanceCommands")),
        result.commandsUnavailable && h16("p", { className: "pw-note" }, t("acceptanceCommandsUnavailable")),
        !result.commandsUnavailable && !commands.length && h16("p", { className: "pw-note" }, t("acceptanceNoCommands")),
        commands.length > 0 && h16("p", { className: "pw-note" }, t("acceptanceOutputLimit")),
        commands.map((command, index) => h16(
          "div",
          { key: index, className: "pw-reading-block" },
          h16("strong", null, t("acceptanceCommand")),
          h16("pre", { className: "pw-text", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, command?.command || t("acceptanceUnknown")),
          h16("strong", null, t("acceptanceOutcome")),
          h16("p", { className: "pw-text" }, outcomeText(command?.outcome, t)),
          h16("strong", null, t("acceptanceTestConclusion")),
          h16(
            "p",
            { className: "pw-text" },
            t(command?.testConclusion === "passed" ? "acceptanceTestPassed" : command?.testConclusion === "failed" ? "acceptanceTestFailed" : "acceptanceTestUnknown")
          ),
          command?.testSummary && h16(import_react16.default.Fragment, null, h16("strong", null, t("acceptanceTestSummary")), h16("p", { className: "pw-text" }, command.testSummary)),
          h16("strong", null, t("acceptanceOutput")),
          h16("pre", { className: "pw-text", style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, command?.output || t("acceptanceNoOutput"))
        ))
      );
      if (!compact) return report;
      const failed = commands.some((command) => command?.testConclusion === "failed");
      return h16(
        import_react16.default.Fragment,
        null,
        h16(
          "details",
          { className: "pw-disclosure pw-assist-disclosure" },
          h16("summary", null, t("acceptanceCheckReport")),
          report
        ),
        staleNotice,
        failed && h16("p", { className: "pw-error", role: "status" }, t("acceptanceTestFailed"))
      );
    };
    if (!reviewable) return null;
    const button = (kind, label) => h16("button", {
      type: "button",
      className: "pw-button",
      disabled: busy || !!entry.pending,
      onClick: () => run(kind)
    }, t(label));
    const help = (label) => h16("p", { className: "pw-note" }, t(label));
    return h16(
      "section",
      { className: "pw-reading-block pw-acceptance-assist", "aria-label": t("acceptanceHelp"), "aria-busy": !!entry.pending },
      h16("h3", { className: "pw-reading-label" }, t("acceptanceHelp")),
      compact ? h16(
        import_react16.default.Fragment,
        null,
        h16("div", { className: "pw-assist-actions" }, button("verify", "acceptanceVerify"), button("guide", "acceptanceGuide")),
        help("acceptanceRunHint"),
        h16(
          "details",
          { className: "pw-disclosure pw-assist-disclosure" },
          h16("summary", null, t("acceptanceHelpDetails")),
          h16("div", { className: "pw-assist-report" }, help("acceptanceVerifyNotice"), help("acceptanceGuideNotice"), help("acceptanceStayOpen"))
        )
      ) : h16(
        import_react16.default.Fragment,
        null,
        help("acceptanceStayOpen"),
        help("acceptanceVerifyNotice"),
        button("verify", "acceptanceVerify"),
        help("acceptanceGuideNotice"),
        button("guide", "acceptanceGuide")
      ),
      entry.pending && h16("p", { className: "pw-note", role: "status" }, t("acceptanceHelpRunning")),
      entry.error && h16("p", { className: "pw-error", role: "alert" }, t("acceptanceHelpError"), entry.error.code ? ` \xB7 ${entry.error.code}` : "", entry.error.message ? `\uFF1A${entry.error.message}` : ""),
      renderResult("verify"),
      renderResult("guide")
    );
  }

  // client-src/detail/task-detail.js
  var h17 = import_react17.default.createElement;
  var { useEffect: useEffect9, useState: useState10 } = import_react17.default;
  function IssueDetail({ issue, req, t, root, mutate, openWikiPage, openTask, onStartTask, onMoveIssue, projectKey, rootRef, onDirty, busy, uiMemory: uiMemory2, editFocus, runFact }) {
    const form = useWorkItemDraft(issueDraftKey(projectKey, req.id, issue.id), issue, issueDraftFrom, onDirty, uiMemory2);
    const [formError, setFormError] = useState10(null);
    const [formFocus, setFormFocus] = useState10("title");
    const [recording, setRecording] = useState10(false);
    const [supplementing, setSupplementing] = useState10(false);
    const [supplement, setSupplement] = useState10("");
    const [notice, setNotice] = useState10("");
    const [assistRunning, setAssistRunning] = useState10(false);
    useEffect9(() => {
      if (editFocus && !["done", "cancelled"].includes(issue.status)) {
        setFormFocus(editFocus);
        form.begin();
      }
    }, []);
    const save = async () => {
      if (busy) return;
      const invalid = taskFormError(form.draft);
      if (invalid) {
        setFormError(invalid);
        return;
      }
      const { fileHash } = form.params();
      const patch = taskContentPatch(form.draft, issue);
      if (!Object.keys(patch).length && fileHash === issue.hash) {
        form.finish();
        return;
      }
      const res = await mutate("issue/update", { root, reqId: req.id, id: issue.id, patch, fileHash }, { inlineError: true });
      if (res.ok && rootRef.current === root) form.finish();
      else if (rootRef.current === root) setFormError(res);
    };
    const terminal = ["done", "cancelled"].includes(issue.status);
    const editing = form.editing && !terminal;
    const inactive = req.status !== "in_progress" || !!req.pendingReopen;
    const mayRecord = !inactive && ["todo", "doing", "blocked"].includes(issue.status);
    const reviewing = !inactive && issue.status === "in_review";
    const hasResult = !!taskResult(issue, req.deliveryStartedAt).summary;
    const missing = startBlockers(issue);
    const runLocked = !!runFact && (["starting", "running"].includes(runFact.runState) || runFact.sessionRunning);
    const begin = (focus = "title") => {
      setFormFocus(focus);
      setFormError(null);
      form.begin();
    };
    const startWork = () => {
      if (missing.length) {
        begin(missing[0]);
        return;
      }
      onStartTask(issue.id);
    };
    const saveSupplement = async (event) => {
      event.preventDefault();
      const value = supplement.trim();
      if (!value || busy) return;
      const res = await mutate("issue/addUpdate", { root, reqId: req.id, id: issue.id, text: "\u963B\u585E\u8865\u5145\uFF1A" + value }, { inlineError: true });
      if (res.ok && rootRef.current === root) {
        setSupplement("");
        setSupplementing(false);
        setNotice(t("supplementSaved"));
      }
    };
    const actions = h17(
      "div",
      { className: "pw-actions" },
      reviewing && h17("button", {
        className: "pw-button primary",
        disabled: busy || runLocked || assistRunning || !hasResult,
        onClick: () => onMoveIssue("done")
      }, t("demoConfirm")),
      reviewing && h17("button", {
        className: "pw-button",
        disabled: busy || runLocked || assistRunning,
        onClick: () => onMoveIssue("todo")
      }, t("reviseTask")),
      !terminal && !inactive && ["todo", "doing", "blocked"].includes(issue.status) && h17(
        "button",
        { className: "pw-button primary", disabled: busy || runLocked, title: runLocked ? t("runRunning") : void 0, onClick: startWork },
        t(missing.length ? "completeTaskInfo" : issue.status === "todo" ? "startTask" : "demoContinue")
      ),
      issue.status === "blocked" && !inactive && h17("button", { className: "pw-button", disabled: busy, onClick: () => setSupplementing((v) => !v) }, t("supplement")),
      h17("button", { className: "pw-button", disabled: busy, onClick: () => openTask(issue.id) }, t("openTaskSession")),
      mayRecord && hasResult && h17("button", {
        className: "pw-button",
        disabled: busy || runLocked,
        onClick: () => mutate("issue/move", { root, reqId: req.id, id: issue.id, to: "in_review", fileHash: issue.hash })
      }, t("submitTaskAcceptance")),
      mayRecord && h17("button", { className: "pw-button pw-quiet", disabled: busy, onClick: () => setRecording(true) }, t("recordTaskResult"))
    );
    return h17(
      "section",
      { className: "pw-subpage pw-issue-page" + (editing ? "" : " pw-read-card"), "aria-label": t("issueDetail") },
      h17(
        "header",
        { className: "pw-subpage-head" },
        h17(
          "div",
          { className: "pw-read-title" },
          h17("h2", null, issue.title),
          h17("span", { className: "pw-count pw-read-status", "data-status": issue.status }, t("st_" + issue.status))
        ),
        !editing && !terminal && h17("button", { className: "pw-button", onClick: () => begin() }, t("edit"))
      ),
      notice && h17("p", { className: "pw-note", role: "status" }, notice),
      runLocked && !editing && h17("p", { className: "pw-note", role: "status" }, t("runRunning")),
      editing ? h17(TaskForm, { form: { ...form, change: (...args) => {
        setFormError(null);
        form.change(...args);
      } }, t, busy, focus: formFocus, error: formError, onSave: save, onCancel: form.finish }) : h17(
        TaskReading,
        { task: issue, since: req.deliveryStartedAt, t, openWikiPage, onAdd: terminal || inactive ? void 0 : (text) => mutate("issue/addUpdate", { root, reqId: req.id, id: issue.id, text }) },
        inactive && h17("p", { className: "pw-note" }, t(req.pendingReopen ? "errReopenPending" : "errNotActive")),
        reviewing && h17(AcceptanceAssist, { req, issue, root, t, busy: busy || runLocked, memory: uiMemory2, onRunningChange: setAssistRunning }),
        actions,
        supplementing && h17(
          "form",
          { className: "pw-progress-form", onSubmit: saveSupplement },
          h17("textarea", { className: "pw-textarea", autoFocus: true, rows: 3, "aria-label": t("supplement"), placeholder: t("supplementPlaceholder"), value: supplement, onChange: (e) => setSupplement(e.target.value) }),
          h17(
            "div",
            { className: "pw-actions" },
            h17("button", { type: "submit", className: "pw-button", disabled: busy || !supplement.trim() }, t("saveSupplement")),
            h17("button", { type: "button", className: "pw-button pw-quiet", disabled: busy, onClick: () => setSupplementing(false) }, t("cancel"))
          )
        )
      ),
      recording && h17(TaskResultForm, {
        task: issue,
        since: req.deliveryStartedAt,
        t,
        busy,
        onClose: () => setRecording(false),
        onSave: (params) => mutate("issue/update", { root, reqId: req.id, id: issue.id, ...params }, { inlineError: true })
      })
    );
  }

  // client-src/detail/acceptance-detail.js
  var import_react18 = __toESM(__require("react"), 1);
  var h18 = import_react18.default.createElement;
  function DeliveryDetail({ req, t, onMove, busy = false }) {
    const returned = reviewRecords(req.reviews).filter((r) => r.kind === "acceptance" && r.decision === "returned");
    const recovering = !!req.pendingReopen;
    const pending = req.status === "pending";
    return h18(
      "section",
      { className: "pw-subpage pw-read-card", "aria-label": t("deliveryDetail") },
      h18(
        "header",
        { className: "pw-subpage-head" },
        h18(
          "div",
          { className: "pw-read-title" },
          h18("h2", null, req.title),
          h18("span", { className: "pw-count pw-read-status", "data-status": req.status }, t("col_" + req.status))
        ),
        h18(
          "div",
          { className: "pw-actions" },
          recovering && h18("button", { className: "pw-button primary", disabled: busy, onClick: () => onMove(req, req.status === "completed" ? "in_progress" : "completed") }, t("resumeReopen")),
          !recovering && pending && h18("button", { className: "pw-button primary", disabled: busy, onClick: () => onMove(req, "completed") }, t("acceptRequirement")),
          !recovering && pending && h18("button", { className: "pw-button", disabled: busy, onClick: () => onMove(req, "in_progress") }, t("sendBack"))
        )
      ),
      h18(DeliveryResult, { req, t, userFacing: true }),
      returned.length > 0 && h18(
        Disclosure,
        { label: t("previousReturns") },
        returned.map((r, i) => h18(
          "div",
          { key: r.marker || i, className: "pw-reading-block" },
          r.at && h18("span", { className: "pw-count" }, String(r.at).replace("T", " ").slice(0, 16)),
          h18(ReadingText, { label: t("reviewOpinion"), value: r.opinion })
        ))
      )
    );
  }
  function RecordDetail({ record, req, t, onOpenRequirement }) {
    return h18(
      "section",
      { className: "pw-subpage pw-read-card", "aria-label": t("recordDetail") },
      h18(
        "header",
        { className: "pw-subpage-head" },
        h18(
          "div",
          { className: "pw-read-title" },
          h18("h2", null, record.reqTitle),
          h18(
            "span",
            { className: "pw-count pw-read-status", "data-status": record.decision === "approved" ? "completed" : "in_progress" },
            t(record.decision === "approved" ? "deliveryAccepted" : "deliveryReturned")
          )
        ),
        h18(
          "div",
          { className: "pw-actions" },
          req ? h18("button", { className: "pw-button", onClick: () => onOpenRequirement(req) }, t("jumpToRequirement")) : h18("span", { className: "pw-note" }, t("errMissing"))
        )
      ),
      h18(
        "div",
        { className: "pw-reading" },
        record.at && h18("p", { className: "pw-note" }, t("decisionAt"), " ", String(record.at).replace("T", " ").slice(0, 16)),
        h18(ReadingText, { label: t("reviewOpinion"), value: record.opinion || t("noOpinion") }),
        h18(ReadingText, { label: t("demoDeliverySummary"), value: record.summary || t("missingDeliverySummary") }),
        h18("p", { className: "pw-note" }, t("recordReadonlyHint"))
      )
    );
  }

  // client-src/shell/main-shell.js
  var h19 = import_react19.default.createElement;
  var { useCallback: useCallback4, useEffect: useEffect10, useRef: useRef7, useState: useState11 } = import_react19.default;
  var EMPTY_WORKSPACES = [];
  var useNoWorkspaces = (selector) => selector({ items: EMPTY_WORKSPACES });
  var useNoSessionStatus = () => void 0;
  var baseName2 = (p) => String(p ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  var foldersFromSessions = (byId) => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const row of Object.values(byId ?? {})) {
      if (!row?.cwd || row.origin === "subagent" || seen.has(row.cwd)) continue;
      seen.add(row.cwd);
      out.push({ workspaceId: "folder:" + row.cwd, path: row.cwd, title: baseName2(row.cwd), sessionIds: [row.id] });
    }
    return out;
  };
  var emptyRequirementDraft = reqDraftFrom({});
  var diagnosticLabels = /* @__PURE__ */ new Map([
    ["WORKSPACE_MISSING", "diagWorkspace"],
    ["READ_FAILED", "diagUnreadable"],
    ["SCHEMA_TOO_NEW", "diagVersion"],
    ["ABSOLUTE_REF", "diagReference"],
    ["BLOCKED_REASON_REQUIRED", "diagBlocked"],
    ["TOO_MANY_ISSUES", "diagLarge"]
  ]);
  var diagListView = (diags, t) => {
    const labels = new Set(diags.map((d) => diagnosticLabels.get(d.code) ?? "diagInconsistent"));
    return h19("ul", { className: "pw-diaglist" }, Array.from(labels, (label) => h19("li", { key: label }, t(label))));
  };
  var PAGE_COMPONENTS = { home: HomePage, pool: PoolPage, review: ReviewPage, ready: ReadyPage, dev: DevPage, blocked: BlockedPage, board: BoardPage, pending: PendingPage, records: RecordsPage };
  var pageLabel = (page) => ({ home: "navHome", pool: "navPool", review: "navReview", ready: "navReady", dev: "navDev", blocked: "navBlocked", board: "navBoard", pending: "navPending", records: "navRecords", wiki: "navWiki", arch: "navArch", sync: "viewSync" })[page] ?? "navHome";
  function MainShell(props) {
    const { t, useCurrentSession, useSessions, useWorkspaces, useSessionStatus, uiMemory: uiMemory2, css: css2, showConversation, enterSession, renderFactorySlot } = props;
    const sessionId = useCurrentSession((v) => v);
    const session = useSessions((s) => sessionId === void 0 ? void 0 : s.byId[sessionId]);
    const sessionRoot = session?.cwd;
    const sessionIndex = useSessions((s) => s?.byId ?? {});
    const sessionStatus = (useSessionStatus ?? useNoSessionStatus)((s) => s);
    const sessionStatusRef = useRef7(sessionStatus);
    sessionStatusRef.current = sessionStatus;
    const mountedRef = useRef7(true);
    useEffect10(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    const useWorkspaceList = useWorkspaces ?? useNoWorkspaces;
    const workspaces = useWorkspaceList((s) => s?.items ?? EMPTY_WORKSPACES) ?? EMPTY_WORKSPACES;
    const workspaceOptions = useWorkspaces ? workspaces : foldersFromSessions(sessionIndex);
    const [picked, setPicked] = useState11(() => uiMemory2.picked ?? null);
    const pickedWorkspace = picked?.id ? workspaces.find((w) => w.workspaceId === picked.id) : void 0;
    const removedWorkspace = !!picked?.id && !pickedWorkspace;
    const root = picked?.id ? pickedWorkspace?.path : picked?.path;
    const currentWorkspace = pickedWorkspace;
    const wsTitle = currentWorkspace?.title || baseName2(root) || t("title");
    const projectKey = picked?.id ? "id:" + picked.id : root ? "path:" + root : "";
    const prevKey = useRef7(projectKey);
    const keyChanged = prevKey.current !== projectKey;
    prevKey.current = projectKey;
    const rootRef = useRef7(root);
    const rootChanged = rootRef.current !== root;
    rootRef.current = root;
    const [nav, setNav] = useState11(() => normalizeViewState(uiMemory2.views[projectKey]));
    const navRef = useRef7(nav);
    navRef.current = nav;
    const lastWritten = useRef7(uiMemory2.views[projectKey]);
    const [data, setData] = useState11(null);
    const [error, setError] = useState11("");
    const [notice, setNotice] = useState11("");
    const [home, setHome] = useState11(null);
    const [homeError, setHomeError] = useState11(null);
    const [runFacts, setRunFacts] = useState11(null);
    const [runError, setRunError] = useState11(null);
    const runAuthSnapshot = useRef7(null);
    const [blocked, setBlocked] = useState11({ proposals: null, deliveryFailed: [] });
    const [modal, setModal] = useState11(null);
    const modalRef = useRef7(modal);
    modalRef.current = modal;
    const [saving, setSaving] = useState11(false);
    const reorderMemory = uiMemory2.reorders ??= {};
    const [, setReorderRevision] = useState11(0);
    const pendingReorder = reorderMemory[projectKey];
    const [focusTarget, setFocusTarget] = useState11("");
    const [editFocus, setEditFocus] = useState11(null);
    const [undo, setUndo] = useState11(null);
    const [git, setGit] = useState11(null);
    const [wsMenu, setWsMenu] = useState11(false);
    const wsAnchor = useRef7(null);
    const [newDraft, setNewDraft] = useState11(() => uiMemory2.newRequirements[projectKey] ?? emptyRequirementDraft);
    const [detailDirty, setDetailDirty] = useState11(false);
    const listSeq = useRef7(0);
    const gitSeq = useRef7(0);
    const homeSeq = useRef7(0);
    const blockedSeq = useRef7(0);
    const runSeq = useRef7(0);
    const runFactsRef = useRef7(null);
    if (keyChanged || rootChanged) runFactsRef.current = null;
    const homeStamp = useRef7(null);
    const homeAuthSnapshot = useRef7(null);
    const dataRef = useRef7(data);
    dataRef.current = data;
    const initialized = !!(data && data.project);
    const refresh = useCallback4(async () => {
      const requested = root;
      if (!requested) return;
      const seq = ++listSeq.current;
      const res = await rpc("requirement/list", { root: requested });
      if (!freshRead(rootRef.current, requested, listSeq.current, seq)) return;
      if (res.ok) {
        setData(res.data);
        setError("");
      } else if (res.code === "NOT_INITIALIZED") {
        setData({ project: null, requirements: [], diagnostics: [{ path: ".project/project.md", code: "NOT_INITIALIZED", message: res.message ?? "not initialized" }] });
        setError("");
      } else setError(res);
    }, [root]);
    const refreshGit = useCallback4(async () => {
      const requested = root;
      if (!requested) return;
      const seq = ++gitSeq.current;
      const res = await rpc("project/gitStatus", { root: requested });
      if (!freshRead(rootRef.current, requested, gitSeq.current, seq)) return;
      setGit(res.ok ? res.data : { available: false });
    }, [root]);
    const authIdentityOf = (facts, statuses) => JSON.stringify([...awaitingAuthDetails(facts, statuses)].map(([issueId, detail]) => [issueId, detail.identity]));
    const authDetailsOf = (facts) => {
      const snapshot = runAuthSnapshot.current;
      const safe = !runError && snapshot?.facts === facts && snapshot.identity === authIdentityOf(facts, sessionStatus);
      return awaitingAuthDetails(safe ? facts : (facts ?? []).map((fact) => ({ ...fact, approvalRequests: [] })), sessionStatus);
    };
    const awaitingAuthOf = (facts) => new Map([...authDetailsOf(facts)].map(([issueId, detail]) => [issueId, detail.sessionId]));
    const authStatusRevision = authIdentityOf(runFacts, sessionStatus);
    const refreshHome = useCallback4(async ({ skipDataRefresh = false, authRetry = 0 } = {}) => {
      const requested = root;
      if (!requested) return;
      const seq = ++homeSeq.current;
      const runRequest = ++runSeq.current;
      const statusAtStart = snapshotAuthStatus(sessionStatusRef.current);
      const runsRes = await rpc("run/list", { root: requested });
      if (!freshRead(rootRef.current, requested, homeSeq.current, seq) || runRequest !== runSeq.current) return;
      const facts = runsRes.ok ? runsRes.data.runs : runFactsRef.current ?? [];
      const authFacts = runsRes.ok ? facts : facts.map((fact) => ({ ...fact, approvalRequests: [] }));
      const currentAuth = () => awaitingAuthDetails(authFacts, sessionStatusRef.current);
      const auth = awaitingAuthDetails(authFacts, statusAtStart);
      const identity = (value) => JSON.stringify([...value].map(([issueId, detail]) => [issueId, detail.identity]));
      const authIdentity = identity(auth);
      if (identity(currentAuth()) !== authIdentity) {
        if (mountedRef.current && rootRef.current === requested && navRef.current.page === "home") {
          if (authRetry < 1) return refreshHome({ skipDataRefresh, authRetry: authRetry + 1 });
          setHomeError({ code: "READ_FAILED", message: "\u6388\u6743\u72B6\u6001\u6301\u7EED\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6" });
        }
        return;
      }
      if (runsRes.ok) {
        runAuthSnapshot.current = { facts, identity: authIdentity };
        runFactsRef.current = facts;
        setRunFacts(facts);
        setRunError(null);
      } else {
        runAuthSnapshot.current = null;
        setRunError(runsRes);
      }
      const running = [...auth].map(([issueId, detail]) => ({
        issueId,
        awaitingAuth: true,
        authAskedAt: detail.askedAt,
        authIdentity: detail.identity
      }));
      const res = await rpc("home/summary", { root: requested, running });
      if (!freshRead(rootRef.current, requested, homeSeq.current, seq) || runRequest !== runSeq.current) return;
      if (identity(currentAuth()) !== authIdentity) {
        if (mountedRef.current && rootRef.current === requested && navRef.current.page === "home") {
          if (authRetry < 1) return refreshHome({ skipDataRefresh, authRetry: authRetry + 1 });
          setHomeError({ code: "READ_FAILED", message: "\u6388\u6743\u72B6\u6001\u6301\u7EED\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6" });
        }
        return;
      }
      if (!res.ok) {
        setHomeError(res);
        return;
      }
      setHomeError(runsRes.ok ? null : runsRes);
      homeAuthSnapshot.current = { facts: authFacts, identity: authIdentity };
      setHome(res.data);
      const changed = homeStamp.current !== res.data.stamp;
      homeStamp.current = res.data.stamp;
      if (changed && !skipDataRefresh) await refresh();
    }, [root, refresh]);
    const refreshBlocked = useCallback4(async ({ authRetry = 0 } = {}) => {
      const requested = root;
      if (!requested) return;
      const seq = ++blockedSeq.current;
      const runRequest = ++runSeq.current;
      const statusAtStart = snapshotAuthStatus(sessionStatusRef.current);
      const [runsRes, propRes] = await Promise.all([rpc("run/list", { root: requested }), rpc("proposal/list", { root: requested })]);
      if (!freshRead(rootRef.current, requested, blockedSeq.current, seq) || runRequest !== runSeq.current) return;
      if (runsRes.ok) {
        const facts = runsRes.data.runs;
        const identity = authIdentityOf(facts, statusAtStart);
        if (identity !== authIdentityOf(facts, sessionStatusRef.current)) {
          if (mountedRef.current && rootRef.current === requested && navRef.current.page === "blocked") {
            if (authRetry < 1) return refreshBlocked({ authRetry: authRetry + 1 });
            runAuthSnapshot.current = null;
            setRunError({ code: "READ_FAILED", message: "\u6388\u6743\u72B6\u6001\u6301\u7EED\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5\u8BFB\u53D6" });
          }
          return;
        }
        runAuthSnapshot.current = { facts, identity };
        runFactsRef.current = facts;
        setRunFacts(facts);
        setRunError(null);
      } else {
        runAuthSnapshot.current = null;
        setRunError(runsRes);
      }
      if (propRes.ok) setBlocked((prev) => ({ ...prev, proposals: propRes.data.proposals }));
      const candidates = (dataRef.current?.requirements ?? []).filter((r) => r.status === "in_progress" && !r.pendingReopen && (r.issues ?? []).length > 0 && r.issues.every((i) => i.status === "done"));
      const failed = [];
      for (const req of candidates) {
        const res = await rpc("delivery/status", { root: requested, reqId: req.id });
        if (!freshRead(rootRef.current, requested, blockedSeq.current, seq)) return;
        if (res.ok && res.data.job?.status === "failed") failed.push({ reqId: req.id, title: req.title, at: Date.parse(res.data.job.endedAt ?? "") || 0 });
      }
      setBlocked((prev) => ({ ...prev, deliveryFailed: failed }));
    }, [root]);
    useEffect10(() => {
      if (keyChanged || rootChanged) {
        setData(null);
        setError("");
        setNotice("");
        setHome(null);
        setHomeError(null);
        setRunFacts(null);
        setRunError(null);
        setBlocked({ proposals: null, deliveryFailed: [] });
        setGit(null);
        setUndo(null);
        setModal(null);
        setSaving(false);
        setFocusTarget("");
        setEditFocus(null);
        setDetailDirty(false);
        homeStamp.current = null;
        const remembered = normalizeViewState(uiMemory2.views[projectKey]);
        lastWritten.current = uiMemory2.views[projectKey];
        setNav(remembered);
        setNewDraft(uiMemory2.newRequirements[projectKey] ?? emptyRequirementDraft);
      }
      refresh();
      refreshGit();
    }, [projectKey, refresh, refreshGit]);
    const page = nav.page;
    useEffect10(() => {
      if (!root) return;
      if (page === "home") refreshHome();
      else if (page === "blocked") {
        refresh();
        refreshBlocked();
      } else refresh();
    }, [page, projectKey, root, initialized]);
    useEffect10(() => {
      if (!root || !initialized) return;
      if (page === "home") refreshHome();
      else if (page === "blocked") refreshBlocked();
    }, [authStatusRevision]);
    useEffect10(() => {
      if (!root || !initialized || page !== "home") return;
      const timer = setInterval(() => {
        if (!document.hidden) refreshHome();
      }, 1e4);
      return () => clearInterval(timer);
    }, [root, initialized, page, refreshHome]);
    useEffect10(() => {
      const onVisibility = () => {
        if (document.hidden || !rootRef.current) return;
        refresh();
        if (navRef.current.page === "home") refreshHome();
        if (navRef.current.page === "blocked") refreshBlocked();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [refresh, refreshHome, refreshBlocked]);
    useEffect10(() => {
      const changed = () => {
        setReorderRevision((n) => n + 1);
        refresh();
      };
      window.addEventListener("pw-reorder-changed", changed);
      return () => window.removeEventListener("pw-reorder-changed", changed);
    }, [refresh]);
    useEffect10(() => {
      if (!projectKey || keyChanged || rootChanged) return;
      uiMemory2.views[projectKey] = nav;
      lastWritten.current = nav;
      uiMemory2.newRequirements[projectKey] = newDraft;
      uiMemory2.picked = picked ? { id: picked.id, path: root } : null;
    }, [projectKey, nav, newDraft, picked, root, keyChanged, rootChanged]);
    useEffect10(() => {
      const external = uiMemory2.views[projectKey];
      if (external && external !== navRef.current && external !== lastWritten.current) {
        lastWritten.current = external;
        setNav(normalizeViewState(external));
      }
    }, [uiMemory2.views[projectKey], projectKey]);
    useEffect10(() => {
      const ext = uiMemory2.picked;
      if (ext && (ext.id !== picked?.id || ext.path !== picked?.path)) setPicked(ext);
    }, [uiMemory2.picked]);
    useEffect10(() => {
      if (!wsMenu) return;
      const close = () => setWsMenu(false);
      const onKey = (e) => {
        if (e.key === "Escape") setWsMenu(false);
      };
      window.addEventListener("click", close);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("click", close);
        window.removeEventListener("keydown", onKey);
      };
    }, [wsMenu]);
    useEffect10(() => {
      if (!focusTarget || keyChanged || rootChanged) return;
      document.getElementById(focusTarget)?.focus();
      setFocusTarget("");
    }, [focusTarget, keyChanged, rootChanged]);
    const mutate = useCallback4(async (method, input, { inlineError = false } = {}) => {
      const requested = root;
      setSaving(true);
      setError("");
      const res = await rpc(method, input);
      if (rootRef.current !== requested) return res;
      if (res.code === "CONFLICT") {
        setError(res);
        setSaving(false);
        return res;
      }
      await refresh();
      if (rootRef.current !== requested) return res;
      if (res.ok) {
        if (navRef.current.page === "home") await refreshHome({ skipDataRefresh: true });
        if (navRef.current.page === "blocked") await refreshBlocked();
      } else if (!inlineError) {
        if (method === "requirement/move" || method === "issue/move") setModal({ kind: "moveError", error: res });
        else setError(res);
      }
      setSaving(false);
      return res;
    }, [refresh, refreshHome, refreshBlocked, root]);
    const requirements = data?.requirements ?? [];
    const params = nav.params;
    const selected = params?.reqId ? requirements.find((r) => r.id === params.reqId) ?? null : null;
    const selectedIssue = params?.issueId ? selected?.issues?.find((i) => i.id === params.issueId) ?? null : null;
    const selectedRecord = params?.record ? (() => {
      const req = requirements.find((r) => r.id === params.record.reqId);
      if (!req) return null;
      return reviewRecords(req.reviews).find((r) => r.kind === "acceptance" && (params.record.marker ? r.marker === params.record.marker : String(r.round) === String(params.record.round))) ?? null;
    })() : null;
    const missingReturn = backOf(nav);
    const missingReturnLabel = !missingReturn.params ? t("backToPage").replace("{page}", t(pageLabel(missingReturn.page))) : selected && missingReturn.params.reqId === selected.id && !missingReturn.params.issueId && !missingReturn.params.record ? t("backToTasks") : t("backToPrevious");
    const writeNav = (next) => {
      lastWritten.current = next;
      if (projectKey) uiMemory2.views[projectKey] = next;
      setNav(next);
    };
    const minorDirty = Object.values(newDraft).some((value) => value.trim());
    const hasUnsaved = minorDirty || detailDirty;
    const clearNewDraft = () => {
      if (projectKey) delete uiMemory2.newRequirements[projectKey];
      setNewDraft(emptyRequirementDraft);
    };
    const clearDrafts = () => {
      if (!projectKey) return;
      clearNewDraft();
      if (selected) delete uiMemory2.drafts[reqDraftKey(projectKey, selected.id)];
      if (selected && selectedIssue) delete uiMemory2.drafts[issueDraftKey(projectKey, selected.id, selectedIssue.id)];
      setDetailDirty(false);
    };
    const guardLeave = (action) => {
      if (hasUnsaved) setModal({ kind: "leave", action });
      else action();
    };
    const guardRef = useRef7(guardLeave);
    guardRef.current = guardLeave;
    const navigate = (page2) => guardLeave(() => {
      setEditFocus(null);
      writeNav({ ...navRef.current, page: page2, params: null, history: [] });
    });
    const openDetailAt = (params2, page2) => guardLeave(() => writeNav(openDetail(navRef.current, params2, page2 ?? navRef.current.page)));
    const back = () => guardLeave(() => {
      const cur = navRef.current;
      if (cur.params?.issueId) setFocusTarget("pw-task-" + cur.params.issueId);
      setEditFocus(null);
      writeNav(backOf(cur));
    });
    const setFilter = (page2, patch) => writeNav(withFilter(navRef.current, page2, patch));
    const createReq = async (openAfter = false) => {
      const invalid = requirementFormError(newDraft);
      if (invalid) return invalid;
      const { title, ...fields } = newDraft;
      const res = await mutate("requirement/create", { root, title, fields }, { inlineError: true });
      if (res.ok && rootRef.current === root) {
        clearNewDraft();
        if (openAfter) writeNav(openDetail(navRef.current, { reqId: res.data.id, issueId: null }, "pool"));
      }
      return res;
    };
    const saveRequirementDraft = async ({ reason } = {}) => {
      const key = reqDraftKey(projectKey, selected.id);
      const draft = uiMemory2.drafts[key];
      if (!draft) return null;
      const invalid = requirementFormError(draft.fields);
      if (invalid) return invalid;
      const res = await mutate("requirement/update", {
        root,
        id: selected.id,
        patch: draft.fields,
        fileHash: draft.fileHash,
        ...reason != null ? { confirmReviewInvalid: true, reason } : {}
      }, { inlineError: true });
      if (res.ok) {
        delete uiMemory2.drafts[key];
        setDetailDirty(false);
      }
      return res;
    };
    const leaveNeedsReview = () => {
      if (!detailDirty || !selected || selectedIssue) return null;
      const draft = uiMemory2.drafts[reqDraftKey(projectKey, selected.id)];
      if (!draft) return null;
      return ["ready", "in_progress"].includes(selected.status) && changesReviewedRequirement(selected, draft.fields) ? draft : null;
    };
    const saveUnsaved = async () => {
      if (minorDirty) {
        const res = await createReq();
        if (!res.ok) return res;
      }
      if (detailDirty && selected && selectedIssue) {
        const key = issueDraftKey(projectKey, selected.id, selectedIssue.id);
        const draft = uiMemory2.drafts[key];
        if (!draft) return null;
        const invalid = taskFormError(draft.fields);
        if (invalid) return invalid;
        const patch = taskContentPatch(draft.fields, selectedIssue);
        if (Object.keys(patch).length || draft.fileHash !== selectedIssue.hash) {
          const res = await mutate("issue/update", { root, reqId: selected.id, id: selectedIssue.id, patch, fileHash: draft.fileHash });
          if (!res.ok) return res;
        }
        delete uiMemory2.drafts[key];
        setDetailDirty(false);
      } else if (detailDirty && selected) {
        const res = await saveRequirementDraft();
        if (res && !res.ok) return res;
      }
      return null;
    };
    const pickProject = (w) => {
      const next = { id: projectIdOf(w), path: w.path };
      guardLeave(() => {
        uiMemory2.picked = next;
        setPicked(next);
      });
    };
    const locateBoard = (req) => guardLeave(() => {
      let next = { ...navRef.current, page: "board", params: null, history: [] };
      if (!req) {
        writeNav(withFilter(next, "board", { cursor: null }));
        return;
      }
      next = withFilter(next, "board", { cursor: req.id, ...req.status === "completed" ? { showCompleted: true } : {} });
      const query = filterOf(next, "board").query ?? "";
      if (query && !req.title.toLowerCase().includes(query.toLowerCase())) next = withFilter(next, "board", { query: "" });
      setFocusTarget("pw-board-" + req.id);
      writeNav(next);
    });
    const locateTask = (reqId, issueId) => guardLeave(() => {
      const req = requirements.find((r) => r.id === reqId);
      if (!req || !req.issues?.some((i) => i.id === issueId)) {
        setError({ code: "NOT_FOUND" });
        return;
      }
      setFocusTarget("pw-task-" + issueId);
      writeNav(openDetail(navRef.current, { reqId, issueId: null }, statusPage(req.status)));
    });
    const locateProposal = ({ reqId, issueId, split }) => {
      const req = requirements.find((r) => r.id === reqId);
      if (!req || issueId && !req.issues?.some((i) => i.id === issueId)) {
        setError({ code: "NOT_FOUND" });
        return;
      }
      if (split) guardLeave(() => {
        setFocusTarget("pw-suggest-" + reqId);
        writeNav(openDetail(navRef.current, { reqId, issueId: null }, req.status === "in_progress" ? "dev" : "board"));
      });
      else if (issueId) locateTask(reqId, issueId);
      else locateBoard(req);
    };
    const openTaskSession = (issueId, sessionId2 = null) => guardLeave(async () => {
      const requested = root;
      const res = await rpc("task/locate", { root: requested, issueId, ...sessionId2 ? { sessionId: sessionId2 } : {} });
      if (rootRef.current !== requested) return;
      if (res.ok) await enterSession(res.data.sessionId);
      else setError(res);
    });
    const startTask = (reqId, issueId) => guardLeave(async () => {
      const requested = root;
      const req = dataRef.current?.requirements.find((r) => r.id === reqId);
      const issue = req?.issues?.find((i) => i.id === issueId);
      if (!issue) {
        setError({ code: "NOT_FOUND" });
        return;
      }
      const missing = startBlockers(issue);
      if (missing.length) {
        setEditFocus(missing[0]);
        writeNav(openDetail(navRef.current, { reqId, issueId }, "dev"));
        return;
      }
      const located = await rpc("task/locate", { root: requested, issueId });
      if (rootRef.current !== requested) return;
      if (!located.ok) {
        setError(located);
        return;
      }
      const res = await rpc("run/start", { root: requested, issueId, sessionId: located.data.sessionId });
      if (rootRef.current !== requested) return;
      if (!res.ok) {
        setError(res);
        return;
      }
      const d = res.data;
      if (d.busy) setError({ code: "SESSION_BUSY" });
      else if (d.uncertain || d.alreadyStarting) setNotice(t("runUncertain"));
      else if (d.alreadyRunning) setNotice(t("runAlready"));
      else if (d.started) setNotice(t("runSubmitted"));
      await enterSession(located.data.sessionId);
      refresh();
    });
    const doMove = useCallback4((req, to) => {
      if (saving || modal || to === req.status) return;
      if (req.pendingReopen) {
        setModal({ kind: "reopenRequirement", req });
        return;
      }
      const kind = MOVES[req.status]?.[to];
      if (!kind) {
        setModal({ kind: "moveError", error: { code: "ILLEGAL_TRANSITION" } });
        return;
      }
      const submit = (reason, inlineError, extra) => mutate("requirement/move", { root, id: req.id, to, reason, fileHash: req.hash, ...extra }, { inlineError });
      if (kind === "move") return submit();
      if (kind === "reason") {
        setModal({ kind, title: t("returnReview"), onOk: (reason) => submit(reason, true) });
        return;
      }
      if (kind === "confirmComplete") {
        setModal({ kind, req, onOk: async (reviewed) => {
          return submit(void 0, true, { fileHash: reviewed.hash, expectFingerprint: await deliveryFingerprint(reviewed) });
        } });
        return;
      }
      setModal({ kind, req, onOk: () => submit(void 0, true) });
    }, [mutate, root, t, saving, modal]);
    const moveIssue = (req, issue, to) => {
      const label = ISSUE_MOVES[issue.status]?.[to];
      if (!label || req.status !== "in_progress" || req.pendingReopen || saving || modal) return;
      const item = { root, reqId: req.id, id: issue.id, fileHash: issue.hash };
      if (to === "done") {
        setModal({ kind: "confirmIssue", issue, req, reqId: req.id });
        return;
      }
      setModal({ kind: "reason", title: t(label), body: issue.title, onOk: (value) => mutate("issue/move", {
        ...item,
        to,
        ...to === "blocked" ? { blockedReason: value } : { reason: value }
      }, { inlineError: true }) });
    };
    const resumeReorder = async (operation) => {
      if (!operation || operation.running) return;
      operation.running = true;
      setReorderRevision((n) => n + 1);
      if (rootRef.current === operation.root) setSaving(true);
      try {
        await continueReorder(operation, {
          read: async () => {
            const result = await rpc("requirement/list", { root: operation.root });
            if (!result.ok) return result;
            const requirements2 = result.data.requirements ?? [];
            const items = operation.kind === "requirement" ? requirements2 : requirements2.find((req) => req.id === operation.reqId)?.issues ?? [];
            return { ok: true, items };
          },
          write: (step) => rpc(operation.kind === "requirement" ? "requirement/update" : "issue/update", operation.kind === "requirement" ? { root: operation.root, id: step.id, patch: { order: step.order }, fileHash: step.hash } : { root: operation.root, reqId: operation.reqId, id: step.id, patch: { order: step.order }, fileHash: step.hash }),
          progress: () => setReorderRevision((n) => n + 1)
        });
      } catch {
        operation.error = { code: "TRANSPORT_ERROR" };
      }
      operation.running = false;
      if (!operation.error) delete reorderMemory[operation.projectKey];
      if (rootRef.current === operation.root) setSaving(false);
      window.dispatchEvent(new Event("pw-reorder-changed"));
    };
    const reorder = (kind, reqId, list, id, direction) => {
      const plan = reorderPlan(list, id, direction);
      if (!plan.length || saving || reorderMemory[projectKey]) return;
      const operation = {
        root,
        projectKey,
        kind,
        reqId,
        next: 0,
        error: null,
        running: false,
        before: list.map((item) => ({ id: item.id, order: item.order })),
        steps: plan.map((step) => ({ ...step, hash: list.find((item) => item.id === step.id)?.hash }))
      };
      reorderMemory[projectKey] = operation;
      void resumeReorder(operation);
    };
    const trashWithUndo = useCallback4(async (kind, id, reqId, label) => {
      const requested = root;
      const res = await rpc("project/trash", { root, kind, id, reqId });
      if (rootRef.current !== requested) return;
      if (res.ok) {
        setUndo({ location: res.data.location, label });
        if (kind === "requirement") writeNav({ ...navRef.current, params: null, history: [] });
        await refresh();
      } else setError(res);
    }, [root, refresh]);
    const doUndo = useCallback4(async () => {
      if (!undo) return;
      const requested = root;
      const res = await rpc("project/restore", { root, location: undo.location });
      if (rootRef.current !== requested) return;
      setUndo(null);
      if (!res.ok) setError(res);
      await refresh();
    }, [undo, root, refresh]);
    const doCommit = useCallback4(async () => {
      const requested = root;
      const res = await rpc("project/gitCommit", { root: requested });
      if (rootRef.current !== requested) return;
      if (!res.ok) setError(res);
      await refreshGit();
    }, [root, refreshGit]);
    const enableProject = async () => {
      const requested = root;
      const res = await rpc("project/init", { root: requested, name: wsTitle });
      if (rootRef.current !== requested) return;
      if (!res.ok) {
        setError(res);
        return;
      }
      await refresh();
      if (rootRef.current !== requested) return;
      writeNav(defaultViewState());
      setNotice(t("workbenchHint"));
    };
    useEffect10(() => {
      const onKey = (e) => {
        if (e.key !== "Escape" || modalRef.current || wsMenu) return;
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
        if (navRef.current.params) {
          e.preventDefault();
          guardRef.current(() => {
            const cur = navRef.current;
            if (cur.params?.issueId) setFocusTarget("pw-task-" + cur.params.issueId);
            writeNav(backOf(cur));
          });
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [wsMenu]);
    const homeSnapshot = homeAuthSnapshot.current;
    const staleHomeAuth = !!home && !!homeSnapshot && homeSnapshot.identity !== authIdentityOf(homeSnapshot.facts, sessionStatus);
    const visibleHome = homeDuringAuthRefresh(home, staleHomeAuth);
    const wb = {
      t,
      root,
      projectKey,
      uiMemory: uiMemory2,
      requirements,
      data,
      error,
      saving: saving || !!pendingReorder,
      nav,
      setFilter,
      navigate,
      openDetail: openDetailAt,
      back,
      locateBoard,
      locateTask,
      mutate,
      refresh,
      doMove,
      moveIssue,
      setModal,
      modal,
      reorder,
      openTaskSession,
      startTask,
      runFacts,
      runError,
      awaitingAuthSessions: awaitingAuthOf(runFacts),
      authDetails: authDetailsOf(runFacts),
      home: visibleHome,
      homeError,
      refreshHome,
      refreshBlocked,
      blocked,
      setFocusTarget
    };
    const titles = workspaceOptions.map((w) => w.title);
    const dupTitles = new Set(titles.filter((x, i) => titles.indexOf(x) !== i));
    const isCurrentProject = (w) => picked?.id ? w.workspaceId === picked.id : w.path === root;
    const wsDropdown = wsMenu && h19(
      "div",
      { className: "pw-ws-menu", role: "menu", "aria-label": t("switchWorkspace"), onClick: (e) => e.stopPropagation() },
      workspaceOptions.map((w) => h19(
        "button",
        {
          key: w.workspaceId,
          role: "menuitem",
          className: "pw-ws-item" + (isCurrentProject(w) ? " active" : ""),
          onClick: () => {
            setWsMenu(false);
            pickProject(w);
          }
        },
        h19("span", { className: "pw-ws-check", "aria-hidden": true }, isCurrentProject(w) ? "\u2713" : ""),
        w.title,
        dupTitles.has(w.title) && h19("span", { className: "pw-count" }, w.path)
      ))
    );
    const wsSwitch = workspaceOptions.length > 0 || picked || renderFactorySlot && useWorkspaces ? h19(
      "div",
      { className: "pw-ws-switch", "data-window-drag-exclude": true },
      h19("button", {
        ref: wsAnchor,
        className: "pw-ws-button",
        title: t("switchWorkspace"),
        "aria-haspopup": "menu",
        "aria-expanded": wsMenu,
        onClick: (e) => {
          e.stopPropagation();
          setWsMenu((v) => !v);
        }
      }, h19("span", { className: "pw-ws-name" }, wsTitle), h19("span", { className: "pw-ws-caret", "aria-hidden": true }, "\u25BE")),
      renderFactorySlot && useWorkspaces ? renderFactorySlot("workspace.picker", {
        open: wsMenu,
        anchorRef: wsAnchor,
        selectedId: picked?.id ?? void 0,
        onPick: (id) => {
          setWsMenu(false);
          pickProject(workspaces.find((x) => x.workspaceId === id) ?? { workspaceId: id });
        },
        onClose: () => setWsMenu(false)
      }, { fallback: wsDropdown }) : wsDropdown
    ) : h19("h1", { className: "pw-title" }, t("title"));
    const menu = h19(
      "nav",
      { className: "pw-menu", "aria-label": t("title") },
      MENU.map((entry) => entry.group ? h19(
        "div",
        { key: entry.group, className: "pw-menu-group" },
        h19("span", { className: "pw-menu-grouptitle" }, t(entry.group)),
        entry.items.map((item) => h19("button", {
          key: item.page,
          className: "pw-menu-item" + (page === item.page && !params ? " active" : ""),
          "aria-current": page === item.page ? "page" : void 0,
          onClick: () => navigate(item.page)
        }, t(item.label)))
      ) : h19("button", {
        key: entry.page,
        className: "pw-menu-item" + (page === entry.page && !params ? " active" : ""),
        "aria-current": page === entry.page ? "page" : void 0,
        onClick: () => navigate(entry.page)
      }, t(entry.label)))
    );
    const topBar = h19(
      "div",
      { className: "pw-top", "data-window-drag": true },
      wsSwitch,
      h19("div", { className: "pw-spacer" }),
      initialized && h19("button", { className: "pw-button" + (page === "sync" ? " primary" : ""), onClick: () => navigate("sync") }, t("viewSync")),
      saving && h19("span", { className: "pw-count" }, t("saving")),
      initialized && git && (git.available ? h19(
        "button",
        { className: "pw-button", onClick: doCommit, title: t("commit") },
        git.uncommitted > 0 ? `${t("commit")} \xB7 ${t("uncommitted").replace("{n}", String(git.uncommitted))}` : t("commit")
      ) : h19("span", { className: "pw-count", title: t("gitUnavailable") }, t("gitUnavailable"))),
      h19("button", { className: "pw-button", onClick: () => guardLeave(showConversation) }, t("back"))
    );
    const errorBanner = error && h19(
      "div",
      { className: "pw-banner pw-error", role: "alert" },
      h19(ErrorDetails, { error, t, showRaw: false }),
      h19("button", { className: "pw-button", style: { marginLeft: "auto" }, onClick: refresh }, t("retryRead"))
    );
    const frame = (content2) => h19(
      "main",
      { className: "pw-page", "aria-label": t("title") },
      h19("style", null, css2),
      topBar,
      h19("div", { className: "pw-shell-body" }, menu, h19("div", { className: "pw-content" }, content2))
    );
    if (!root) {
      return frame(h19(
        "div",
        { className: "pw-init" },
        h19("h2", null, t("chooseWorkspace")),
        h19("p", { className: "pw-note" }, removedWorkspace ? t("workspaceRemoved") : workspaceOptions.length ? t("chooseWorkspaceHint") : t("noWorkspacesHint")),
        !!workspaceOptions.length && h19("div", { className: "pw-workspace-list" }, workspaceOptions.map((w) => h19("button", {
          key: w.workspaceId,
          className: "pw-workspace-card",
          onClick: () => pickProject(w)
        }, h19("strong", null, w.title), h19("span", { className: "pw-count" }, w.path))))
      ));
    }
    if (!data || keyChanged || rootChanged) {
      return frame(error ? h19(
        "div",
        { className: "pw-init" },
        h19("h2", null, t("readFailedTitle")),
        h19(ErrorDetails, { error, t, showRaw: false }),
        h19("button", { className: "pw-button primary", onClick: refresh }, t("retryRead"))
      ) : h19("div", { className: "pw-init" }, h19("p", null, t("loading"))));
    }
    const { diags, readFailed } = classifyProject(data);
    if (readFailed) {
      return frame(h19(
        "div",
        { className: "pw-init" },
        h19("h2", null, t("readFailedTitle")),
        h19("p", { className: "pw-note" }, t("readFailedHint")),
        errorBanner,
        diagListView(diags, t),
        h19("button", { className: "pw-button primary", onClick: refresh }, t("retryRead"))
      ));
    }
    if (!initialized) {
      return frame(h19(
        "div",
        { className: "pw-init" },
        h19("h2", null, t("initTitle")),
        h19("p", { className: "pw-note" }, t("initBody")),
        h19("strong", null, wsTitle),
        h19("p", { className: "pw-note", style: { overflowWrap: "anywhere" } }, root),
        errorBanner,
        h19("button", { className: "pw-button primary", onClick: enableProject }, t("initTitle"))
      ));
    }
    const breadcrumbs = h19(
      "nav",
      { className: "pw-breadcrumb", "aria-label": "Breadcrumb" },
      h19("button", { className: "pw-crumb", onClick: () => guardLeave(() => writeNav({ ...navRef.current, params: null, history: [] })) }, t(pageLabel(page))),
      selected && h19(
        import_react19.default.Fragment,
        null,
        h19("span", { className: "pw-crumb-sep" }, "/"),
        selectedIssue || page === "pending" && params?.reqId && !selectedRecord ? h19("button", { className: "pw-crumb", onClick: back, title: selected.title }, t(page === "pending" ? "navPending" : "backToTasks")) : h19("span", { className: "pw-crumb-current" }, selected.title)
      ),
      selectedIssue && h19(
        import_react19.default.Fragment,
        null,
        h19("span", { className: "pw-crumb-sep" }, "/"),
        h19("span", { className: "pw-crumb-current" }, selectedIssue.title)
      ),
      selectedRecord && h19(
        import_react19.default.Fragment,
        null,
        h19("span", { className: "pw-crumb-sep" }, "/"),
        h19("span", { className: "pw-crumb-current" }, t("recordDetail"))
      )
    );
    let content;
    if (params?.record) {
      content = selectedRecord ? h19("div", { className: "pw-subpage-stack" }, h19(RecordDetail, {
        record: { ...selectedRecord, reqTitle: requirements.find((r) => r.id === params.record.reqId)?.title ?? selectedRecord.reqTitle },
        req: requirements.find((r) => r.id === params.record.reqId) ?? null,
        t,
        onOpenRequirement: (req) => openDetailAt({ reqId: req.id, issueId: null }, statusPage(req.status))
      })) : h19("div", { className: "pw-init" }, h19("p", null, t("errMissing")), h19("button", { className: "pw-button", onClick: back }, missingReturnLabel));
    } else if (params?.reqId && !selected) {
      content = h19("div", { className: "pw-init" }, h19("p", null, t("errMissing")), h19("button", { className: "pw-button", onClick: back }, missingReturnLabel));
    } else if (params?.issueId && !selectedIssue) {
      content = h19("div", { className: "pw-init" }, h19("p", null, t("errMissing")), h19("button", { className: "pw-button", onClick: back }, missingReturnLabel));
    } else if (selectedIssue) {
      content = h19("div", { className: "pw-subpage-stack" }, h19(IssueDetail, {
        key: projectKey + ":" + selectedIssue.id,
        issue: selectedIssue,
        req: selected,
        t,
        root,
        mutate,
        projectKey,
        rootRef,
        onDirty: setDetailDirty,
        busy: saving,
        uiMemory: uiMemory2,
        editFocus,
        runFact: (runFacts ?? []).find((f) => f.issueId === selectedIssue.id) ?? null,
        openTask: openTaskSession,
        onStartTask: (issueId) => startTask(selected.id, issueId),
        onMoveIssue: (to) => moveIssue(selected, selectedIssue, to),
        openWikiPage: (p) => guardLeave(() => writeNav({ ...navRef.current, page: "wiki", params: { wikiTarget: p }, history: [] }))
      }));
    } else if (selected && page === "pending") {
      content = h19("div", { className: "pw-subpage-stack" }, h19(DeliveryDetail, {
        req: selected,
        t,
        onMove: doMove,
        busy: saving || !!pendingReorder || !!modal
      }));
    } else if (selected) {
      content = h19(
        "div",
        { className: "pw-subpage-stack" },
        h19(DetailPanel, {
          key: projectKey + ":" + selected.id,
          req: selected,
          t,
          root,
          mutate,
          moveIssue,
          projectKey,
          rootRef,
          onDirty: setDetailDirty,
          busy: saving || !!pendingReorder,
          sessionId: sessionRoot === root ? sessionId : void 0,
          setModal,
          uiMemory: uiMemory2,
          onDelete: () => setModal({ kind: "delete", req: selected }),
          onOpenIssue: (id) => guardLeave(() => writeNav(openDetail(navRef.current, { reqId: selected.id, issueId: id }))),
          onReorderTask: (id, direction) => reorder("issue", selected.id, sortedTasks(selected.issues), id, direction),
          onStartTask: (issueId) => startTask(selected.id, issueId),
          onCreateTask: () => setModal({ kind: "createTask", req: selected, onCreated: (id) => {
            if (rootRef.current === root) setFocusTarget("pw-task-" + id);
          } })
        })
      );
    } else if (page === "wiki") {
      content = h19(WikiView, {
        key: root,
        root,
        sessionId: sessionRoot === root ? sessionId : void 0,
        t,
        uiMemory: uiMemory2,
        target: params?.wikiTarget ?? null,
        onPageChange: (path) => writeNav({ ...navRef.current, params: path ? { wikiTarget: path } : null })
      });
    } else if (page === "arch") {
      content = h19(ArchView, { key: root, root, sessionId: sessionRoot === root ? sessionId : void 0, t });
    } else if (page === "sync") {
      content = h19(SyncView, { key: projectKey, root, sessionId: sessionRoot === root ? sessionId : void 0, t, refresh, requirements, onLocateProposal: locateProposal });
    } else {
      const Page = PAGE_COMPONENTS[page] ?? HomePage;
      content = h19(Page, { wb });
    }
    return frame(h19(
      import_react19.default.Fragment,
      null,
      breadcrumbs,
      errorBanner,
      pendingReorder && h19(
        "div",
        { className: "pw-banner pw-warn", role: "status" },
        h19(
          "div",
          null,
          h19("span", null, t("reorderProgress").replace("{done}", String(pendingReorder.next)).replace("{total}", String(pendingReorder.steps.length))),
          pendingReorder.error && h19("p", null, t("reorderFailed")),
          pendingReorder.error && h19(ErrorDetails, { error: pendingReorder.error, t, showRaw: false })
        ),
        pendingReorder.error && h19("button", { className: "pw-button", disabled: pendingReorder.running, onClick: () => resumeReorder(pendingReorder) }, t("reorderRetry")),
        pendingReorder.error && h19("button", { className: "pw-button", disabled: pendingReorder.running, onClick: () => {
          delete reorderMemory[projectKey];
          setReorderRevision((n) => n + 1);
          refresh();
        } }, t("reorderDiscard"))
      ),
      notice && h19(
        "div",
        { className: "pw-banner", role: "status" },
        notice,
        h19("button", { className: "pw-button", style: { marginLeft: "auto" }, onClick: () => setNotice(""), "aria-label": t("dismiss") }, "\u2715")
      ),
      diags.length > 0 && h19(
        "div",
        { className: "pw-banner pw-warn", role: "status" },
        h19(
          "div",
          { className: "pw-diagwrap" },
          h19("strong", null, t("dataProblems").replace("{n}", String(diags.length))),
          h19("details", null, h19("summary", null, t("details")), diagListView(diags, t))
        ),
        h19("button", { className: "pw-button", style: { marginLeft: "auto" }, onClick: refresh }, t("retryRead"))
      ),
      undo && h19(
        "div",
        { className: "pw-banner", role: "status" },
        t("trashed"),
        h19("button", { className: "pw-button", style: { marginLeft: "auto" }, onClick: doUndo }, t("undo")),
        h19("button", { className: "pw-button", onClick: () => setUndo(null), "aria-label": t("dismiss") }, "\u2715")
      ),
      content,
      selected && !selectedIssue && !selectedRecord && h19(PrdDocuments, {
        key: projectKey + ":" + selected.id + ":" + (params?.prdId ?? ""),
        root,
        reqId: selected.id,
        initialId: params?.prdId,
        t
      }),
      modal && modal.kind !== "leave" && h19(ReasonModal, {
        key: modal.kind,
        modal,
        t,
        setModal,
        mutate,
        root,
        trashWithUndo,
        requirements,
        newDraft,
        clearNewDraft,
        changeNewDraft: (name, value) => setNewDraft((draft) => ({ ...draft, [name]: value })),
        createReq: () => createReq(true),
        reopenState: modal.kind === "reopenRequirement" && requirements.find((req) => req.id === modal.req.id)?.pendingReopen
      }),
      modal?.kind === "leave" && h19(LeaveModal, {
        modal,
        t,
        busy: saving,
        onStay: () => setModal(null),
        onDiscard: () => {
          const action = modal.action;
          clearDrafts();
          setModal(null);
          action();
        },
        onSave: async () => {
          if (!minorDirty && leaveNeedsReview()) {
            const action2 = modal.action;
            setModal({
              kind: "reason",
              title: t("confirmReviewEdit"),
              body: t("confirmReviewEditBody"),
              onOk: async (reason) => {
                const res = await saveRequirementDraft({ reason });
                if (res?.ok) action2();
                return res;
              }
            });
            return;
          }
          const failed = await saveUnsaved();
          if (rootRef.current !== root) return;
          if (failed) {
            setModal((m) => m && m.kind === "leave" ? { ...m, error: workbenchError(failed, t).text } : m);
            return;
          }
          const action = modal.action;
          setModal(null);
          action();
        }
      })
    ));
  }

  // client-src/rightbar/task-pane.js
  var import_react20 = __toESM(__require("react"), 1);

  // client-src/rightbar/task-state.js
  function taskRunView(status, run) {
    const pending = status?.pendingInteraction;
    const waiting = !!pending;
    const running = status?.running === true;
    const locked = running || waiting || ["starting", "uncertain", "running"].includes(run?.state);
    const description = waiting ? pending?.kind === "approval" ? "runWaiting" : "runInteraction" : running ? "runRunning" : run?.state === "starting" ? "runStarting" : run?.state === "uncertain" ? "runUncertain" : status?.running === false ? "runIdle" : "unknownRun";
    const action = waiting && pending?.kind === "approval" ? "goAuthorize" : "viewConversation";
    const switchHint = waiting ? "switchInteraction" : running ? "switchRunning" : locked ? "switchPending" : null;
    return { running, waiting, locked, pending, description, action, switchHint };
  }
  function taskChoices(requirements, { query = "", reqId = "" } = {}) {
    const needle = query.trim().toLocaleLowerCase();
    return (requirements ?? []).flatMap((req) => (req.issues ?? []).filter((issue) => (!reqId || req.id === reqId) && (!needle || [issue.title, taskOverview(issue)].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)))).map((issue) => ({ ...issue, reqId: req.id, requirementTitle: req.title, requirementStatus: req.status })));
  }
  function stampNeedsRead(previous, next) {
    if (!previous) return false;
    if (previous.modified == null) return previous.hash != null && next.hash !== previous.hash;
    return previous.modified !== next.modified || previous.hash !== next.hash;
  }
  var terminalTask = (task) => ["done", "cancelled"].includes(task?.status);

  // client-src/rightbar/task-pane.js
  var h20 = import_react20.default.createElement;
  var { useCallback: useCallback5, useEffect: useEffect11, useRef: useRef8, useState: useState12 } = import_react20.default;
  var EMPTY_WORKSPACES2 = [];
  var useNoWorkspaces2 = (selector) => selector({ items: EMPTY_WORKSPACES2 });
  var useNoSessionStatus2 = () => void 0;
  var useVisibleTab = () => ({ tab: { visible: true } });
  var rightbarLocale = {
    en: {
      backMain: "Workbench",
      viewConversation: "View conversation",
      goAuthorize: "Review permission",
      swapTask: "Switch task",
      linkedTask: "Current task",
      pickNewTask: "Switch to this task",
      retryLink: "Retry linking",
      completeTaskInfo: "Fill in task info",
      parentRequirement: "Requirement",
      requirementDelivery: "Requirement delivery",
      selectDevRequirement: "Select a requirement in development",
      runInteraction: "The conversation needs your attention.",
      switchInteraction: "Handle the pending item in the conversation before switching tasks.",
      switchRunning: "Wait for AI to finish, or stop it in the conversation and let its records save before switching.",
      switchPending: "A processing request or its records are still being checked. Wait before switching tasks or requesting changes.",
      switchSyncing: "Task records are still being saved. Try switching when this finishes.",
      searchTasks: "Search title or overview",
      allRequirements: "All requirements",
      createAndLink: "Create and link",
      noTaskChoices: "No tasks match. Clear the filters or create a task in a requirement in development.",
      taskLinked: "Task linked. No processing request was sent.",
      taskCreated: "Task created and linked as To do.",
      moreActions: "More actions",
      returnTodo: "Return to To do",
      restoreTask: "Restore",
      reopenTaskAction: "Reopen",
      cancelTask: "Cancel task",
      cancelReason: "Why is this task being cancelled?",
      returnReason: "Why is this task returning to To do?",
      reopenReason: "Why are you reopening this task?",
      supplement: "Add information",
      supplementPlaceholder: "What is now available, and what should happen next?",
      saveSupplement: "Save information",
      supplementSaved: "Information saved. No processing request was sent.",
      deferDecision: "Not now",
      deferred: "Still awaiting your confirmation.",
      submitAndContinue: "Save changes and continue",
      continueSaved: "Your requested changes were saved, but a new request has not been confirmed. Wait for any existing work to finish, then use Continue; do not save the same request again.",
      manualConfirm: "Confirm completion manually",
      aiTaskDraft: "Draft with AI",
      drafting: "Drafting\u2026",
      aiUpdated: "Task details were updated",
      newAiUpdate: "The saved task has changed",
      keepMyDraft: "Keep my draft",
      loadNewContent: "Load new content",
      createLinkFailed: "The task was saved. Retry linking it to this conversation.",
      runSubmitted: "One processing request was submitted.",
      runAlready: "A processing request already exists; no duplicate was sent.",
      runUncertain: "The submission result is unclear. The existing request is being checked; no new request was sent.",
      noTaskCreateHint: "Open the workbench, or create a task under a requirement in development.",
      unsavedForm: "Save or discard your edits before continuing.",
      taskMissingTitle: "The linked task is unavailable"
    },
    zh: {
      backMain: "\u5DE5\u4F5C\u53F0",
      viewConversation: "\u67E5\u770B\u4F1A\u8BDD",
      goAuthorize: "\u53BB\u6388\u6743",
      swapTask: "\u6362\u4EFB\u52A1",
      linkedTask: "\u5F53\u524D\u5173\u8054",
      pickNewTask: "\u6362\u6210\u6B64\u4EFB\u52A1",
      retryLink: "\u91CD\u8BD5\u5173\u8054",
      completeTaskInfo: "\u8865\u9F50\u4FE1\u606F",
      parentRequirement: "\u6240\u5C5E\u9700\u6C42",
      requirementDelivery: "\u9700\u6C42\u4EA4\u4ED8",
      selectDevRequirement: "\u9009\u62E9\u5F00\u53D1\u4E2D\u7684\u9700\u6C42",
      runInteraction: "\u4F1A\u8BDD\u4E2D\u6709\u5F85\u5904\u7406\u4E8B\u9879\u3002",
      switchInteraction: "\u4F1A\u8BDD\u4E2D\u6709\u5F85\u5904\u7406\u4E8B\u9879\uFF0C\u8BF7\u5148\u5728\u4F1A\u8BDD\u4E2D\u5904\u7406\u540E\u518D\u5207\u6362\u4EFB\u52A1\u3002",
      switchRunning: "AI \u6B63\u5728\u5904\u7406\u3002\u8BF7\u7B49\u5F85\u7ED3\u675F\uFF0C\u6216\u5148\u5728\u4F1A\u8BDD\u4E2D\u505C\u6B62\u5E76\u7B49\u5F85\u8BB0\u5F55\u4FDD\u5B58\uFF0C\u518D\u5207\u6362\u4EFB\u52A1\u3002",
      switchPending: "\u5904\u7406\u8BF7\u6C42\u6216\u4EFB\u52A1\u8BB0\u5F55\u4ECD\u5728\u6838\u5BF9\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u518D\u5207\u6362\u4EFB\u52A1\u6216\u63D0\u51FA\u4FEE\u6539\u3002",
      switchSyncing: "\u6B63\u5728\u4FDD\u5B58\u4EFB\u52A1\u8BB0\u5F55\uFF0C\u8BF7\u4FDD\u5B58\u5B8C\u6210\u540E\u518D\u5207\u6362\u3002",
      searchTasks: "\u641C\u7D22\u6807\u9898\u6216\u6982\u8FF0",
      allRequirements: "\u5168\u90E8\u9700\u6C42",
      createAndLink: "\u521B\u5EFA\u5E76\u5173\u8054",
      noTaskChoices: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u4EFB\u52A1\u3002\u53EF\u4EE5\u6E05\u7A7A\u7B5B\u9009\uFF0C\u6216\u5728\u5F00\u53D1\u4E2D\u9700\u6C42\u4E0B\u65B0\u5EFA\u4EFB\u52A1\u3002",
      taskLinked: "\u5DF2\u5173\u8054\u4EFB\u52A1\uFF0C\u6CA1\u6709\u63D0\u4EA4\u5904\u7406\u8BF7\u6C42\u3002",
      taskCreated: "\u4EFB\u52A1\u5DF2\u521B\u5EFA\u5E76\u5173\u8054\uFF0C\u72B6\u6001\u4E3A\u5F85\u5904\u7406\u3002",
      moreActions: "\u66F4\u591A\u64CD\u4F5C",
      returnTodo: "\u9000\u56DE\u5F85\u529E",
      restoreTask: "\u6062\u590D",
      reopenTaskAction: "\u91CD\u5F00",
      cancelTask: "\u53D6\u6D88\u4EFB\u52A1",
      cancelReason: "\u4E3A\u4EC0\u4E48\u53D6\u6D88\u8FD9\u9879\u4EFB\u52A1\uFF1F",
      returnReason: "\u4E3A\u4EC0\u4E48\u9000\u56DE\u5F85\u5904\u7406\uFF1F",
      reopenReason: "\u4E3A\u4EC0\u4E48\u91CD\u65B0\u6253\u5F00\u8FD9\u9879\u4EFB\u52A1\uFF1F",
      supplement: "\u8865\u5145\u8BF4\u660E",
      supplementPlaceholder: "\u73B0\u5728\u8865\u5145\u4E86\u4EC0\u4E48\uFF0C\u63A5\u4E0B\u6765\u9700\u8981\u600E\u4E48\u5904\u7406\uFF1F",
      saveSupplement: "\u4FDD\u5B58\u8865\u5145\u8BF4\u660E",
      supplementSaved: "\u8865\u5145\u8BF4\u660E\u5DF2\u4FDD\u5B58\uFF0C\u6CA1\u6709\u63D0\u4EA4\u5904\u7406\u8BF7\u6C42\u3002",
      deferDecision: "\u7A0D\u540E\u9A8C\u6536",
      deferred: "\u4EFB\u52A1\u4ECD\u5904\u4E8E\u5F85\u9A8C\u6536\u3002",
      submitAndContinue: "\u63D0\u4EA4\u5E76\u7EE7\u7EED\u5904\u7406",
      continueSaved: "\u4FEE\u6539\u8981\u6C42\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5C1A\u672A\u786E\u8BA4\u63D0\u4EA4\u65B0\u7684\u5904\u7406\u8BF7\u6C42\u3002\u8BF7\u7B49\u5F85\u5DF2\u6709\u5904\u7406\u7ED3\u675F\u540E\u70B9\u51FB\u7EE7\u7EED\u5904\u7406\uFF0C\u65E0\u9700\u91CD\u590D\u4FDD\u5B58\u4FEE\u6539\u8981\u6C42\u3002",
      manualConfirm: "\u4EBA\u5DE5\u786E\u8BA4\u5B8C\u6210",
      aiTaskDraft: "AI \u8D77\u8349",
      drafting: "\u6B63\u5728\u8D77\u8349\u2026",
      aiUpdated: "\u4EFB\u52A1\u5185\u5BB9\u5DF2\u66F4\u65B0",
      newAiUpdate: "\u5DF2\u4FDD\u5B58\u7684\u4EFB\u52A1\u6709\u66F4\u65B0",
      keepMyDraft: "\u4FDD\u7559\u8349\u7A3F",
      loadNewContent: "\u52A0\u8F7D\u65B0\u5185\u5BB9",
      createLinkFailed: "\u4EFB\u52A1\u5DF2\u4FDD\u5B58\u3002\u53EF\u4EE5\u91CD\u8BD5\u5173\u8054\u5230\u5F53\u524D\u4F1A\u8BDD\u3002",
      runSubmitted: "\u5DF2\u63D0\u4EA4\u4E00\u6B21\u5904\u7406\u8BF7\u6C42\u3002",
      runAlready: "\u5DF2\u6709\u5904\u7406\u8BF7\u6C42\uFF0C\u6CA1\u6709\u91CD\u590D\u63D0\u4EA4\u3002",
      runUncertain: "\u63D0\u4EA4\u7ED3\u679C\u4E0D\u660E\u786E\uFF0C\u6B63\u5728\u6838\u5BF9\u539F\u8BF7\u6C42\uFF0C\u6CA1\u6709\u53E6\u884C\u53D1\u8D77\u65B0\u8BF7\u6C42\u3002",
      noTaskCreateHint: "\u53EF\u4EE5\u8FDB\u5165\u4E3B\u5DE5\u4F5C\u53F0\uFF0C\u6216\u5728\u5F00\u53D1\u4E2D\u9700\u6C42\u4E0B\u521B\u5EFA\u5E76\u5173\u8054\u4EFB\u52A1\u3002",
      unsavedForm: "\u8BF7\u5148\u4FDD\u5B58\u6216\u653E\u5F03\u5F53\u524D\u4FEE\u6539\u3002",
      taskMissingTitle: "\u539F\u5173\u8054\u4EFB\u52A1\u6682\u65F6\u65E0\u6CD5\u6253\u5F00"
    }
  };
  function TaskPane({ t, useCurrentSession, useSessions, useSessionStatus, useWorkspaces, useTabInfo, openMain, showConversation, uiMemory: uiMemory2, css: css2 }) {
    const sessionId = useCurrentSession((value) => value);
    const session = useSessions((state) => sessionId === void 0 ? void 0 : state?.byId?.[sessionId]);
    const sessionStatus = (useSessionStatus ?? useNoSessionStatus2)((state) => sessionId === void 0 ? void 0 : state?.get(sessionId));
    const workspaces = (useWorkspaces ?? useNoWorkspaces2)((state) => state?.items ?? EMPTY_WORKSPACES2) ?? EMPTY_WORKSPACES2;
    const visible = (useTabInfo ?? useVisibleTab)().tab.visible;
    const root = session?.cwd;
    if (!sessionId) return null;
    const registered = workspaces.find((item) => item.path === root || (item.sessionIds ?? []).includes(sessionId));
    const workspace = registered ? { ...registered, workspaceId: registered.workspaceId ?? registered.id } : null;
    const projectKey = workspace?.workspaceId && !String(workspace.workspaceId).startsWith("folder:") ? "id:" + workspace.workspaceId : "path:" + root;
    const openObject = (reqId, wikiPage = null, status = null) => {
      uiMemory2.picked = { id: projectIdOf(workspace), path: root };
      const current = normalizeViewState(uiMemory2.views[projectKey]);
      uiMemory2.views[projectKey] = wikiPage ? { ...current, page: "wiki", params: { wikiTarget: wikiPage }, history: [] } : openDetail(current, { reqId, issueId: null }, statusPage(status));
      openMain();
    };
    return h20(
      "aside",
      { className: "pw-page pw-task-pane", "aria-label": t("issueDetail") },
      h20("style", null, css2),
      root ? h20(LinkedTask, {
        key: root + "|" + sessionId,
        root,
        sessionId,
        sessionStatus,
        visible,
        projectKey,
        t,
        uiMemory: uiMemory2,
        openMain,
        showConversation,
        openRequirement: (reqId, status) => openObject(reqId, null, status),
        openWikiPage: (reqId, path) => openObject(reqId, path)
      }) : h20("p", null, t("noWorkspace"))
    );
  }
  function LinkedTask({ root, sessionId, sessionStatus, visible, projectKey, t, uiMemory: uiMemory2, openMain, showConversation, openRequirement, openWikiPage }) {
    const [linkState, setLinkState] = useState12(null);
    const [task, setTask] = useState12(null);
    const [req, setReq] = useState12(null);
    const [proposals, setProposals] = useState12([]);
    const [delivery, setDelivery] = useState12(null);
    const [missing, setMissing] = useState12(false);
    const [readError, setReadError] = useState12(null);
    const [error, setError] = useState12(null);
    const [notice, setNotice] = useState12("");
    const [busy, setBusy] = useState12(false);
    const [loading, setLoading] = useState12(true);
    const [syncing, setSyncing] = useState12(true);
    const [externalUpdate, setExternalUpdate] = useState12(false);
    const [picking, setPicking] = useState12(false);
    const [choices, setChoices] = useState12(null);
    const [pickerBusy, setPickerBusy] = useState12(false);
    const [createdTask, setCreatedTask] = useState12(null);
    const [leave, setLeave] = useState12(null);
    const active = useRef8(false);
    const linkSeq = useRef8(0);
    const taskSeq = useRef8(0);
    const choiceSeq = useRef8(0);
    const stamp = useRef8({ modified: null, hash: null });
    const linkRef = useRef8(null);
    const taskRef = useRef8(null);
    const leaveRef = useRef8(null);
    const switchButton = useRef8(null);
    const focusSwitch = useRef8(false);
    const visibleRef = useRef8(visible);
    visibleRef.current = visible;
    linkRef.current = linkState?.link ?? null;
    taskRef.current = task;
    const runView = taskRunView(sessionStatus, linkState?.run);
    const loadTask = useCallback5(async (link, origin = "action") => {
      if (!link) return;
      const seq = ++taskSeq.current;
      const [reqRes, proposalRes, deliveryRes] = await Promise.all([
        rpc("requirement/get", { root, id: link.reqId }),
        rpc("proposal/list", { root }),
        rpc("delivery/status", { root, reqId: link.reqId })
      ]);
      if (!active.current || !visibleRef.current || document.hidden || seq !== taskSeq.current) return;
      if (!reqRes.ok) {
        setReadError(reqRes);
        if (reqRes.code === "NOT_FOUND") {
          setTask(null);
          setReq(null);
          setMissing(true);
        }
        return;
      }
      const requirement = { ...reqRes.data, hasCancelled: (reqRes.data.issues ?? []).some((issue) => issue.status === "cancelled") };
      const found = (requirement.issues ?? []).find((issue) => issue.id === link.issueId);
      const previous = taskRef.current;
      if (origin === "poll" && found && previous?.id === found.id && previous.hash !== found.hash) setExternalUpdate(true);
      setReq(requirement);
      const currentTask = found ? { ...found, reqId: requirement.id } : null;
      setTask(currentTask);
      setMissing(!found);
      setReadError(null);
      if (found) stamp.current = { modified: null, hash: found.hash };
      setProposals(proposalRes.ok ? proposalRes.data.proposals.filter((proposal) => !isRequirementSplit(proposal) && proposal.status === "pending" && proposal.target.reqId === requirement.id && (proposal.target.issueId === link.issueId || proposal.kind === "new_task")) : []);
      setDelivery(deliveryRes.ok ? deliveryRes.data.job : null);
      if (!proposalRes.ok) setError(proposalRes);
      else if (!deliveryRes.ok) setError(deliveryRes);
      return currentTask;
    }, [root]);
    const load = useCallback5(async () => {
      if (!visibleRef.current || document.hidden) return;
      const seq = ++linkSeq.current;
      taskSeq.current++;
      setSyncing(true);
      const res = await rpc("link/get", { root, sessionId, catchUp: true });
      if (!active.current || !visibleRef.current || document.hidden || seq !== linkSeq.current) return;
      taskSeq.current++;
      if (!res.ok) {
        linkRef.current = null;
        setLinkState(null);
        setReadError(res);
        setLoading(false);
        setSyncing(false);
        return;
      }
      linkRef.current = res.data.link;
      setLinkState(res.data);
      setReadError(null);
      setMissing(false);
      const link = res.data.link;
      if (!link) {
        setTask(null);
        setReq(null);
        setProposals([]);
        setDelivery(null);
        setLoading(false);
        setSyncing(false);
        return;
      }
      if (taskRef.current?.id !== link.issueId) {
        setTask(null);
        setReq(null);
        setExternalUpdate(false);
      }
      const currentTask = await loadTask(link);
      if (!active.current || !visibleRef.current || document.hidden || seq !== linkSeq.current) return;
      setLoading(false);
      setSyncing(false);
      return currentTask;
    }, [root, sessionId, loadTask]);
    useEffect11(() => {
      if (picking || !focusSwitch.current) return;
      focusSwitch.current = false;
      switchButton.current?.focus();
    }, [picking]);
    useEffect11(() => {
      active.current = true;
      return () => {
        active.current = false;
        linkSeq.current++;
        taskSeq.current++;
        choiceSeq.current++;
      };
    }, [load]);
    useEffect11(() => {
      if (visible) load();
      else {
        linkSeq.current++;
        taskSeq.current++;
      }
    }, [load, visible]);
    useEffect11(() => {
      const onVisibility = () => {
        if (document.hidden) {
          linkSeq.current++;
          taskSeq.current++;
        } else if (visibleRef.current) load();
      };
      document.addEventListener("visibilitychange", onVisibility);
      return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [load]);
    const wasRunning = useRef8(runView.running);
    useEffect11(() => {
      if (visible && wasRunning.current && !runView.running) load();
      wasRunning.current = runView.running;
    }, [runView.running, load, visible]);
    useEffect11(() => {
      if (!visible || !task || readError) return;
      const timer = setInterval(async () => {
        if (document.hidden || !visibleRef.current || !active.current || !linkRef.current) return;
        const linkVersion = linkSeq.current;
        const detailVersion = taskSeq.current;
        const res = await rpc("task/stamp", { root, reqId: task.reqId, id: task.id });
        if (!active.current || !visibleRef.current || document.hidden || linkVersion !== linkSeq.current || detailVersion !== taskSeq.current || taskRef.current?.id !== task.id || taskRef.current?.reqId !== task.reqId || linkRef.current?.issueId !== task.id || linkRef.current?.reqId !== task.reqId) return;
        if (!res.ok) {
          setReadError(res);
          return;
        }
        const previous = stamp.current;
        if (stampNeedsRead(previous, res.data)) {
          stamp.current = res.data;
          await loadTask(linkRef.current, "poll");
        } else if (previous.modified == null) stamp.current = res.data;
      }, 3e3);
      return () => clearInterval(timer);
    }, [root, task?.id, task?.hash, !!readError, loadTask, visible]);
    const actionRef = useRef8(null);
    if (!actionRef.current) actionRef.current = createCardActions({
      getKey: () => active.current ? sessionId : null,
      rpc,
      setBusy,
      setMsg: setError,
      reload: load,
      formatError: (res) => res
    });
    const act = actionRef.current;
    const guardLeave = useCallback5((action) => {
      if (leaveRef.current?.dirty()) setLeave({ action, error: null });
      else action();
    }, []);
    const openMainGuard = () => guardLeave(openMain);
    const choose = async () => {
      if (runView.locked) {
        setError({ code: "SESSION_BUSY", message: t(runView.switchHint) });
        return;
      }
      if (syncing) {
        setError({ code: "SYNC_PENDING", message: t("switchSyncing") });
        return;
      }
      const seq = ++choiceSeq.current;
      setError(null);
      setNotice("");
      setPicking(true);
      setPickerBusy(true);
      const res = await rpc("requirement/list", { root });
      if (!active.current || seq !== choiceSeq.current) return;
      setPickerBusy(false);
      if (!res.ok) {
        setError(res);
        return;
      }
      setChoices(res.data.requirements);
    };
    const closePicker = () => {
      choiceSeq.current++;
      focusSwitch.current = !!task;
      setPicking(false);
      setChoices(null);
      setPickerBusy(false);
      setCreatedTask(null);
      setError(null);
    };
    const linkTask = async (issueId, message) => {
      const res = await act("link/set", { root, sessionId, issueId });
      if (!active.current || !res?.ok) return false;
      closePicker();
      setNotice(t(message));
      return true;
    };
    const attach = (issueId) => guardLeave(async () => {
      if (runView.locked || syncing || busy) return;
      await linkTask(issueId, "taskLinked");
    });
    const createAndLink = (reqId, input) => guardLeave(async () => {
      if (runView.locked || syncing || busy || createdTask) return;
      const created = await act("issue/create", { root, reqId, ...input });
      if (!created?.ok || !active.current) return;
      const saved = { id: created.data.id, title: input.title };
      setCreatedTask(saved);
      await linkTask(saved.id, "taskCreated");
    });
    const start = async (issueId) => {
      const res = await act("run/start", { root, sessionId, issueId });
      if (!res?.ok || !active.current) return res;
      const data = res.data;
      if (data.busy) setError({ code: "SESSION_BUSY" });
      else if (data.uncertain || data.alreadyStarting) setNotice(t("runUncertain"));
      else if (data.alreadyRunning) setNotice(t("runAlready"));
      else if (data.started) setNotice(t("runSubmitted"));
      return res;
    };
    const switchHint = runView.switchHint ? t(runView.switchHint) : syncing ? t("switchSyncing") : "";
    const notices = h20(
      import_react20.default.Fragment,
      null,
      switchHint && !loading && h20(
        "div",
        { className: "pw-sidebar-notice", role: "status" },
        h20("span", null, switchHint),
        runView.locked && !runView.running && !runView.waiting && h20("button", { className: "pw-button pw-quiet", disabled: syncing, onClick: load }, t("retry"))
      ),
      h20(ErrorDetails, { error, t, showRaw: false }),
      notice && h20("p", { className: "pw-note", role: "status" }, notice),
      readError && h20(
        "div",
        { className: "pw-sidebar-notice" },
        h20(ErrorDetails, { error: readError, t, showRaw: false }),
        h20("button", { className: "pw-button pw-quiet", disabled: syncing, onClick: load }, t("retry"))
      ),
      loading && !task && !readError && h20("p", { className: "pw-note", role: "status" }, t("loading"))
    );
    const toolbar = (children, canSwitch = false) => h20(
      "div",
      { className: "pw-task-toolbar" },
      h20("button", { className: "pw-button pw-quiet", onClick: openMainGuard }, h20("span", { "aria-hidden": true }, "\u2039 "), t("backMain")),
      h20(
        "div",
        { className: "pw-task-tools" },
        canSwitch && h20("button", { className: "pw-button pw-quiet", ref: switchButton, disabled: busy || !!switchHint, title: switchHint, onClick: choose }, t("swapTask")),
        children
      )
    );
    return h20(
      import_react20.default.Fragment,
      null,
      task && h20("div", { hidden: picking }, h20(LinkedTaskDetails, {
        key: task.reqId + "|" + task.id,
        task,
        req,
        runView,
        linkState,
        proposals,
        delivery,
        t,
        root,
        sessionId,
        projectKey,
        uiMemory: uiMemory2,
        busy,
        act,
        start,
        openRequirement: (reqId, status) => guardLeave(() => openRequirement(reqId, status)),
        openWikiPage: (reqId, path) => guardLeave(() => openWikiPage(reqId, path)),
        showConversation: () => guardLeave(showConversation),
        readError,
        syncing,
        externalUpdate,
        leaveRef,
        guardLeave,
        toolbar,
        notices,
        reload: load
      })),
      (picking || !task) && h20(
        import_react20.default.Fragment,
        null,
        toolbar(),
        notices,
        !loading && h20(TaskPicker, {
          requirements: choices,
          t,
          busy: busy || !!switchHint,
          loading: pickerBusy,
          picking,
          missing,
          currentId: task?.id,
          createdTask,
          onRetryLink: () => {
            if (!busy && !switchHint && createdTask) linkTask(createdTask.id, "taskCreated");
          },
          onChoose: choose,
          onRetry: load,
          retryBusy: syncing,
          onAttach: attach,
          onCreate: createAndLink,
          onCancel: closePicker
        })
      ),
      leave && h20(LeaveModal, {
        modal: leave,
        t,
        busy,
        onStay: () => {
          setLeave(null);
          if (picking && task) closePicker();
        },
        onDiscard: () => {
          const action = leave.action;
          leaveRef.current?.discard();
          setLeave(null);
          action();
        },
        onSave: async () => {
          const ok = await leaveRef.current?.save();
          if (!ok?.ok) {
            setLeave((current) => current ? { ...current, error: ok ? workbenchError(ok, t).text : t("saveFailed") } : current);
            return;
          }
          const action = leave.action;
          setLeave(null);
          action();
        }
      })
    );
  }
  function TaskPicker({
    requirements,
    t,
    busy,
    loading,
    picking,
    missing,
    currentId,
    createdTask,
    onChoose,
    onRetry,
    retryBusy,
    onAttach,
    onCreate,
    onCancel,
    onRetryLink
  }) {
    const [query, setQuery] = useState12("");
    const [reqId, setReqId] = useState12("");
    const [choice, setChoice] = useState12("");
    const [draft, setDraft] = useState12(issueDraftFrom);
    const [createReqId, setCreateReqId] = useState12("");
    const [error, setError] = useState12(null);
    if (!requirements) return h20(
      "section",
      { className: "pw-subpage pw-task-picker", "aria-label": t("pickTask") },
      h20("h2", null, t(missing ? "taskMissingTitle" : "pickTask")),
      h20("p", { className: "pw-note" }, t(loading ? "loading" : missing ? "linkMissing" : picking ? "errUnreadable" : "noLinkedTask")),
      h20(
        "div",
        { className: "pw-actions" },
        missing && !picking && h20("button", { className: "pw-button pw-quiet", disabled: retryBusy, onClick: onRetry }, t("retry")),
        !loading && h20("button", { className: "pw-button primary", disabled: busy, onClick: onChoose }, t(picking ? "retry" : "pickTask")),
        picking && h20("button", { className: "pw-button pw-quiet", onClick: onCancel }, t("cancel"))
      )
    );
    const items = taskChoices(requirements, { query, reqId });
    const development = requirements.filter((req) => req.status === "in_progress" && !req.pendingReopen);
    const createFor = createReqId || (development.length === 1 ? development[0].id : "");
    const create = (event) => {
      event.preventDefault();
      if (busy || createdTask) return;
      const invalid = taskFormError(draft);
      setError(invalid ?? (createFor ? null : { code: "REQ_NOT_ACTIVE" }));
      if (invalid || !createFor) return;
      onCreate(createFor, newTaskInput(draft));
    };
    return h20(
      "section",
      { className: "pw-subpage pw-task-picker", "aria-label": t("pickTask") },
      h20(
        "div",
        { className: "pw-task-picker-head" },
        h20("h2", null, t(currentId ? "swapTask" : "pickTask")),
        h20("button", { className: "pw-button pw-quiet", disabled: busy, onClick: onCancel }, t("cancel"))
      ),
      createdTask ? h20(
        "div",
        { className: "pw-sidebar-notice", role: "status" },
        h20("p", { className: "pw-text" }, t("createLinkFailed")),
        h20("strong", null, createdTask.title),
        h20("button", { className: "pw-button primary", disabled: busy, onClick: onRetryLink }, t("retryLink"))
      ) : h20(
        import_react20.default.Fragment,
        null,
        h20(
          "label",
          { className: "pw-field" },
          h20("span", { className: "pw-label" }, t("searchTasks")),
          h20("input", { className: "pw-input", autoFocus: true, value: query, onChange: (event) => {
            setQuery(event.target.value);
            setChoice("");
          } })
        ),
        h20(
          "label",
          { className: "pw-field" },
          h20("span", { className: "pw-label" }, t("parentRequirement")),
          h20(
            "select",
            { className: "pw-select", value: reqId, onChange: (event) => {
              setReqId(event.target.value);
              setChoice("");
            } },
            h20("option", { value: "" }, t("allRequirements")),
            requirements.map((req) => h20("option", { key: req.id, value: req.id }, req.title))
          )
        ),
        items.length ? h20("div", { className: "pw-choice-list", role: "radiogroup", "aria-label": t("pickTask") }, items.map((issue) => {
          const current = currentId === issue.id;
          return h20(
            "label",
            { key: issue.id, className: "pw-choice", "data-selected": choice === issue.id },
            h20("input", {
              type: "radio",
              name: "pw-task-choice",
              value: issue.id,
              checked: choice === issue.id,
              disabled: current || busy,
              onChange: () => setChoice(issue.id)
            }),
            h20(
              "span",
              { className: "pw-choice-copy" },
              h20("strong", null, issue.title),
              h20("span", { className: "pw-note" }, issue.requirementTitle, " \xB7 ", t("st_" + issue.status), current && " \xB7 " + t("linkedTask")),
              taskOverview(issue) && h20("span", { className: "pw-preview" }, taskOverview(issue))
            )
          );
        })) : h20("p", { className: "pw-note" }, t("noTaskChoices")),
        items.length > 0 && h20(
          "button",
          { className: "pw-button primary", disabled: busy || !choice, onClick: () => onAttach(choice) },
          t(currentId ? "pickNewTask" : "linkTask")
        ),
        development.length > 0 && h20(
          Disclosure,
          { label: t("createAndLink") },
          h20(
            "form",
            { noValidate: true, onSubmit: create },
            h20(
              "label",
              { className: "pw-field" },
              h20("span", { className: "pw-label" }, t("parentRequirement")),
              h20(
                "select",
                { className: "pw-select", value: createFor, disabled: busy, onChange: (event) => {
                  setCreateReqId(event.target.value);
                  setError(null);
                } },
                h20("option", { value: "" }, t("selectDevRequirement")),
                development.map((req) => h20("option", { key: req.id, value: req.id }, req.title))
              )
            ),
            h20(TaskFields, { form: { draft, change: (name, value) => {
              setError(null);
              setDraft((previous) => ({ ...previous, [name]: value }));
            } }, t, busy, focus: null }),
            h20(ErrorDetails, { error, t, showRaw: false }),
            h20("button", { className: "pw-button", type: "submit", disabled: busy }, t("createAndLink"))
          )
        )
      )
    );
  }
  function LinkedTaskDetails({
    task,
    req,
    runView,
    linkState,
    proposals,
    delivery,
    t,
    root,
    sessionId,
    projectKey,
    uiMemory: uiMemory2,
    busy,
    act,
    start,
    openRequirement,
    openWikiPage,
    showConversation,
    readError,
    syncing,
    externalUpdate,
    leaveRef,
    guardLeave,
    toolbar,
    notices,
    reload
  }) {
    const form = useTaskDraft(issueDraftKey(projectKey, task.reqId, task.id), task, uiMemory2);
    const [formFocus, setFormFocus] = useState12("title");
    const [formError, setFormError] = useState12(null);
    const [continueEditing, setContinueEditing] = useState12(false);
    const [continueText, setContinueText] = useState12("");
    const [continueSaved, setContinueSaved] = useState12(false);
    const [supplementing, setSupplementing] = useState12(false);
    const [supplement, setSupplement] = useState12("");
    const [reasonMove, setReasonMove] = useState12(null);
    const [reason, setReason] = useState12("");
    const [reasonError, setReasonError] = useState12(null);
    const [notice, setNotice] = useState12("");
    const [recording, setRecording] = useState12(false);
    const [manualReview, setManualReview] = useState12(null);
    const [reviewError, setReviewError] = useState12(null);
    const [assistRunning, setAssistRunning] = useState12(false);
    const deliveryDraftKey = "delivery:" + projectKey + "|" + task.reqId;
    const [deliveryDraftDirty, setDeliveryDraftDirty] = useState12(() => !!uiMemory2.drafts[deliveryDraftKey]);
    const lastDeliveryReq = useRef8(null);
    if (lastDeliveryReq.current?.id !== task.reqId) lastDeliveryReq.current = null;
    if (req?.id === task.reqId) lastDeliveryReq.current = req;
    const deliveryReq = req?.id === task.reqId ? req : lastDeliveryReq.current;
    const menu = useRef8(null);
    const terminal = terminalTask(task);
    const item = { root, reqId: task.reqId, id: task.id };
    const inactive = req?.status !== "in_progress" || !!req.pendingReopen;
    const available = !inactive && !runView.locked && !readError && !syncing;
    const missing = startBlockers(task);
    const missingText = missing.length ? t("errRequiredFields").replace("{fields}", missing.map((name) => t(name === "problemOverview" ? "taskOverviewField" : name === "acceptance" ? "requirementCriteria" : "issueTitle")).join(t("fieldSeparator"))) : "";
    const taskSince = req?.id === task.reqId ? req.deliveryStartedAt : deliveryReq?.deliveryStartedAt;
    const hasResult = !!taskResult(task, taskSince).summary;
    const reviewable = available && !busy && !assistRunning && !form.dirty && hasResult;
    const begin = (focus = "title") => {
      setFormFocus(focus);
      setFormError(null);
      form.begin();
    };
    const save = async () => {
      const invalid = taskFormError(form.draft);
      if (invalid) {
        setFormError(invalid);
        return invalid;
      }
      const params = form.params();
      if (!Object.keys(params.patch).length && params.fileHash === task.hash) {
        form.finish();
        return { ok: true };
      }
      const res = await act("issue/update", { ...item, ...params });
      if (res?.ok) form.finish();
      else setFormError(res);
      return res;
    };
    useEffect11(() => {
      leaveRef.current = { dirty: () => form.dirty, save, discard: form.finish };
      return () => {
        leaveRef.current = null;
      };
    });
    useEffect11(() => {
      const clickOutside = (event) => {
        if (menu.current?.open && !menu.current.contains(event.target)) menu.current.open = false;
      };
      document.addEventListener("click", clickOutside);
      return () => document.removeEventListener("click", clickOutside);
    }, []);
    const move = async () => {
      if (busy || !reason.trim()) return;
      const res = await act("issue/move", { ...item, to: reasonMove, reason: reason.trim(), fileHash: task.hash });
      if (res?.ok) {
        setReasonMove(null);
        setReason("");
        setReasonError(null);
      } else setReasonError(res);
    };
    const reasonTitle = reasonMove === "cancelled" ? t("cancelReason") : terminal ? t("reopenReason") : t("returnReason");
    const confirm = async (snapshot) => {
      setReviewError(null);
      const res = await act("issue/confirm", { ...item, fileHash: snapshot.hash });
      if (res?.ok) setManualReview(null);
      else if (manualReview) setReviewError(res);
      if (res?.code === "CONFLICT") {
        const refreshed = await reload();
        if (refreshed?.id === task.id) setManualReview((previous) => previous && refreshed);
      }
    };
    const startWork = async () => {
      if (missing.length) {
        begin(missing[0]);
        return;
      }
      const res = await start(task.id);
      if (res?.ok && res.data.started) setContinueSaved(false);
      if (res?.code === "MISSING_START_FIELDS") await reload();
    };
    const continueWork = async (event) => {
      event.preventDefault();
      if (!continueText.trim() || !available || busy || assistRunning) return;
      if (missing.length) {
        begin(missing[0]);
        return;
      }
      const saved = await act("issue/continue", { ...item, text: continueText.trim(), fileHash: task.hash });
      if (!saved?.ok) return;
      setContinueEditing(false);
      setContinueText("");
      setContinueSaved(true);
      await startWork();
    };
    const saveSupplement = async (event) => {
      event.preventDefault();
      const value = supplement.trim();
      if (!value || busy) return;
      const res = await act("issue/addUpdate", { ...item, text: "\u963B\u585E\u8865\u5145\uFF1A" + value });
      if (res?.ok) {
        setSupplement("");
        setSupplementing(false);
        setNotice(t("supplementSaved"));
      }
    };
    const beginMove = (to) => {
      setReason("");
      setReasonError(null);
      setReasonMove(to);
    };
    const mayRecord = available && ["todo", "doing", "blocked"].includes(task.status);
    const menuAction = (label, onClick, danger = false) => h20("button", {
      key: label,
      className: "pw-button pw-quiet" + (danger ? " danger" : ""),
      disabled: busy,
      onClick: () => {
        if (menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
        onClick();
      }
    }, t(label));
    const menuItems = available && !form.editing ? [
      mayRecord && menuAction("recordTaskResult", () => setRecording(true)),
      mayRecord && hasResult && menuAction("submitTaskAcceptance", () => act("issue/move", { ...item, to: "in_review", fileHash: task.hash })),
      mayRecord && hasResult && menuAction("manualConfirm", () => {
        setReviewError(null);
        setManualReview(task);
      }),
      ["doing", "blocked", "in_review"].includes(task.status) && menuAction("returnTodo", () => beginMove("todo")),
      !terminal && menuAction("cancelTask", () => beginMove("cancelled"), true),
      terminal && menuAction(task.status === "done" ? "reopenTaskAction" : "restoreTask", () => beginMove("todo"))
    ].filter(Boolean) : [];
    const more = menuItems.length > 0 && h20(
      "details",
      {
        className: "pw-task-menu",
        ref: menu,
        onKeyDown: (event) => {
          if (event.key !== "Escape" || !menu.current?.open) return;
          event.stopPropagation();
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
      },
      h20("summary", { "aria-label": t("moreActions"), title: t("moreActions") }, h20("span", { "aria-hidden": true }, "\u22EF")),
      h20("div", { className: "pw-task-menu-items" }, menuItems)
    );
    const primary = (label, onClick, disabled = busy) => h20("button", { className: "pw-button primary", disabled, onClick }, t(label));
    const quiet = (label, onClick, disabled = busy) => h20("button", { className: "pw-button pw-quiet", disabled, onClick }, t(label));
    const row = (...actions) => h20("div", { className: "pw-task-action-row" }, actions);
    let action;
    if (!terminal && (runView.waiting || runView.running)) {
      action = row(primary(runView.action, showConversation));
    } else if (available && task.status === "in_review") {
      action = h20(
        "div",
        { className: "pw-review-actions" },
        row(
          primary("demoConfirm", () => confirm(task), !reviewable),
          h20(
            "div",
            { className: "pw-review-options" },
            quiet("reviseTask", () => setContinueEditing((value) => !value), busy || assistRunning),
            quiet("deferDecision", () => {
              setContinueEditing(false);
              setNotice(t("deferred"));
            })
          )
        ),
        continueEditing && h20(
          "form",
          { className: "pw-progress-form", onSubmit: continueWork },
          h20("textarea", { className: "pw-textarea", rows: 3, autoFocus: true, "aria-label": t("askFix"), placeholder: t("askFix"), value: continueText, onChange: (event) => setContinueText(event.target.value) }),
          h20("button", { type: "submit", className: "pw-button", disabled: busy || assistRunning || !continueText.trim() }, t("submitAndContinue"))
        )
      );
    } else if (available && task.status === "blocked") {
      action = h20(
        import_react20.default.Fragment,
        null,
        row(
          primary("supplement", () => setSupplementing((value) => !value)),
          quiet(missing.length ? "completeTaskInfo" : "demoContinue", startWork)
        ),
        supplementing && h20(
          "form",
          { className: "pw-progress-form", onSubmit: saveSupplement },
          h20("textarea", { className: "pw-textarea", autoFocus: true, rows: 3, "aria-label": t("supplement"), placeholder: t("supplementPlaceholder"), value: supplement, onChange: (event) => setSupplement(event.target.value) }),
          h20("button", { type: "submit", className: "pw-button", disabled: busy || !supplement.trim() }, t("saveSupplement"))
        )
      );
    } else if (available && ["todo", "doing"].includes(task.status)) {
      action = row(primary(missing.length ? "completeTaskInfo" : task.status === "todo" ? "startTask" : "demoContinue", startWork));
    }
    const activeDelivery = !!deliveryReq && (deliveryReq.status === "pending" || deliveryReq.status === "in_progress" && delivery?.status === "failed" || deliveryDraftDirty);
    return h20(
      import_react20.default.Fragment,
      null,
      toolbar(more, true),
      notices,
      h20(
        "section",
        { className: "pw-subpage pw-read-card pw-sidebar-detail", "aria-label": t("issueDetail") },
        h20(
          "header",
          { className: "pw-sidebar-heading" },
          h20(
            "div",
            { className: "pw-sidebar-title" },
            h20("h2", null, task.title),
            !terminal && !form.editing && quiet("edit", () => begin())
          ),
          h20(
            "div",
            { className: "pw-sidebar-meta" },
            h20("span", { className: "pw-count pw-read-status", "data-status": task.status }, t("st_" + task.status)),
            req && h20(
              "button",
              { className: "pw-button pw-quiet pw-parent-link", onClick: () => openRequirement(req.id, req.status) },
              t("parentRequirement"),
              " \xB7 ",
              req.title
            )
          ),
          runView.locked && h20("p", { className: "pw-note", role: "status" }, t(runView.description))
        ),
        form.updateAvailable && h20(
          "div",
          { className: "pw-banner pw-warn", role: "alert" },
          h20("span", null, t("newAiUpdate")),
          quiet("keepMyDraft", form.keepUpdate),
          quiet("loadNewContent", () => {
            setFormError(null);
            form.loadUpdate();
          })
        ),
        notice && h20("p", { className: "pw-note", role: "status" }, notice),
        continueSaved && h20("p", { className: "pw-text pw-error", role: "alert" }, t("continueSaved")),
        form.editing && !terminal ? h20(
          import_react20.default.Fragment,
          null,
          h20(TaskForm, {
            form: { ...form, change: (...args) => {
              setFormError(null);
              form.change(...args);
            } },
            t,
            busy,
            focus: formFocus,
            error: formError,
            onSave: save,
            onCancel: () => form.dirty ? guardLeave(() => {
            }) : form.finish()
          }),
          available && missing.length > 0 && quiet(busy ? "drafting" : "aiTaskDraft", () => act("issue/draft", { ...item, sessionId }))
        ) : h20(
          import_react20.default.Fragment,
          null,
          inactive && h20("p", { className: "pw-note" }, t(req?.pendingReopen ? "errReopenPending" : "errNotActive")),
          h20(
            TaskReading,
            {
              task,
              requirement: deliveryReq,
              since: taskSince,
              t,
              sidebar: true,
              openWikiPage: (path) => openWikiPage(task.reqId, path),
              resultActions: task.status === "in_review" ? h20(
                import_react20.default.Fragment,
                null,
                !inactive && h20(AcceptanceAssist, {
                  req,
                  issue: task,
                  root,
                  sessionId,
                  t,
                  busy: busy || !available,
                  memory: uiMemory2,
                  onRunningChange: setAssistRunning,
                  compact: true
                }),
                action
              ) : null
            },
            !terminal && task.status !== "in_review" && missingText && !runView.locked && h20("p", { className: "pw-note" }, missingText),
            task.status !== "in_review" && action,
            linkState?.link?.unrecorded && h20("p", { className: "pw-note" }, t("demoUnrecorded"))
          ),
          externalUpdate && h20("p", { className: "pw-note", role: "status" }, t("aiUpdated")),
          activeDelivery && h20(
            Disclosure,
            { label: t("requirementDelivery") },
            deliveryReq.status === "pending" && !deliveryDraftDirty ? h20(DeliveryResult, { req: deliveryReq, t, compact: true, userFacing: true }) : h20(
              import_react20.default.Fragment,
              null,
              deliveryReq.status === "in_progress" && delivery?.status === "failed" && h20("p", { className: "pw-error" }, t("demoDeliveryFailed")),
              h20(ManualDelivery, {
                key: root + "|" + deliveryReq.id,
                req: deliveryReq,
                t,
                act,
                root,
                busy,
                userFacing: true,
                onDraftChange: setDeliveryDraftDirty,
                draftMemory: uiMemory2.drafts,
                draftKey: deliveryDraftKey
              })
            )
          )
        ),
        !terminal && proposals.length > 0 && h20(
          Disclosure,
          { label: t("demoDrafts") },
          h20(DraftSuggestions, { proposals, act, root, t, busy: busy || form.dirty, dismissMethod: "proposal/dismiss", showHeading: false })
        ),
        h20(
          "div",
          { hidden: form.editing && !terminal },
          h20(UpdateLog, {
            activity: task.activity,
            t,
            onAdd: !terminal && !inactive ? (text) => act("issue/addUpdate", { ...item, text: "\u4EBA\u5DE5\u64CD\u4F5C\uFF1A" + text }) : void 0,
            userFacing: true,
            timeline: true,
            openWikiPage: (path) => openWikiPage(task.reqId, path)
          })
        )
      ),
      recording && h20(TaskResultForm, {
        task,
        since: taskSince,
        t,
        busy,
        onClose: () => setRecording(false),
        onSave: (params) => available ? act("issue/update", { ...item, ...params }) : { ok: false, code: "RUNNING" }
      }),
      manualReview && h20(Modal, { title: t("confirmIssueTitle"), wide: true, onClose: () => {
        if (!busy) setManualReview(null);
      }, actions: [
        quiet("cancel", () => setManualReview(null)),
        primary("demoConfirm", () => confirm(manualReview), !reviewable || !taskResult(manualReview, taskSince).summary)
      ] }, h20(TaskResult, { task: manualReview, since: taskSince, t, userFacing: true }), h20(ErrorDetails, { error: reviewError, t, showRaw: false })),
      reasonMove && h20(
        Modal,
        { title: reasonTitle, onClose: () => {
          if (!busy) setReasonMove(null);
        }, actions: [
          quiet("cancel", () => setReasonMove(null)),
          primary("ok", move, busy || !reason.trim())
        ] },
        h20("textarea", {
          className: "pw-textarea",
          autoFocus: true,
          rows: 3,
          value: reason,
          "aria-label": reasonTitle,
          onChange: (event) => {
            setReason(event.target.value);
            setReasonError(null);
          }
        }),
        h20(ErrorDetails, { error: reasonError, t, showRaw: false })
      )
    );
  }

  // client-src/conversation.js
  var import_react21 = __toESM(__require("react"), 1);
  var import_dsh_client_ui_primitives = __require("@deepseek-ai/dsh-client-ui-primitives");
  var { createElement: h21, useEffect: useEffect12, useRef: useRef9, useState: useState13 } = import_react21.default;
  var generating = /* @__PURE__ */ new Set(["running", "stopping", "starting"]);
  var confirmPrompts = { remove: "removePrompt", restore: "restorePrompt", start: "startPrompt" };
  var confirmActions = { remove: "pwbMoveToTrash", restore: "pwbRestore", start: "pwbStart", prd: "savePrd", reviewEdit: "pwbConfirm" };
  var useNoWorkspaces3 = () => null;
  var conversationLocale = {
    zh: {
      workbenchMention: "\u5728\u5F53\u524D\u9879\u76EE\u4F7F\u7528\u5DE5\u4F5C\u53F0",
      workbenchHint: "\u5728\u804A\u5929\u6846\u8F93\u5165 /pwb \u9009\u62E9\u64CD\u4F5C\uFF0C\u6216\u7528 @workbench \u76F4\u63A5\u4EA4\u4EE3\u3002",
      workbenchConversation: "\u4F1A\u8BDD\u4E2D\u7684\u9879\u76EE\u5DE5\u4F5C\u53F0",
      openWorkbenchObject: "\u5728\u5DE5\u4F5C\u53F0\u67E5\u770B",
      openAcceptance: "\u6253\u5F00\u4EFB\u52A1\u4E0E\u9A8C\u6536",
      removePrompt: "\u5C06\u6B64\u8349\u7A3F\u79FB\u5230\u56DE\u6536\u7AD9\uFF1F",
      restorePrompt: "\u5C06\u6B64\u8349\u7A3F\u6062\u590D\u5230\u9700\u6C42\u6C60\uFF1F",
      startPrompt: "\u5F00\u59CB\u5904\u7406\u8FD9\u9879\u4EFB\u52A1\uFF1F",
      prdMarkdown: "PRD \u8349\u7A3F\uFF08Markdown\uFF09",
      prds: "\u5173\u8054 PRD",
      savePrd: "\u4FDD\u5B58 PRD",
      checkPrdVersion: "\u6838\u5BF9\u5DF2\u4FDD\u5B58\u7248\u672C",
      prdBefore: "\u539F\u7248\u672C\u4E2D\u7684\u6539\u52A8\u90E8\u5206",
      prdAfter: "\u8349\u7A3F\u4E2D\u7684\u6539\u52A8\u90E8\u5206",
      prdDiff: "\u67E5\u770B\u65B0\u65E7\u5DEE\u5F02",
      noPrdDiff: "\u5185\u5BB9\u6CA1\u6709\u53D8\u5316",
      pwbCheckPassed: "\u901A\u8FC7",
      pwbCheckFailed: "\u5931\u8D25",
      pwbCheckIncomplete: "\u5F85\u6838\u5B9E",
      pwbConfirm: "\u786E\u8BA4",
      pwbCancel: "\u53D6\u6D88",
      pwbDismiss: "\u5173\u95ED",
      pwbRetry: "\u91CD\u8BD5",
      pwbPrdReady: "PRD \u8349\u7A3F\u5DF2\u5C31\u7EEA",
      pwbPreviewPrd: "\u9884\u89C8\u5E76\u4FDD\u5B58",
      pwbDiscardPrd: "\u653E\u5F03\u8349\u7A3F",
      pwbPrdSaved: "PRD \u5DF2\u4FDD\u5B58",
      pwbOpenPrd: "\u67E5\u770B PRD",
      pwbPreviewAction: "\u67E5\u770B\u5E76\u786E\u8BA4",
      pwbDetails: "\u67E5\u770B\u8BE6\u60C5",
      pwbReviewDetails: "\u6838\u5BF9\u9A8C\u6536",
      pwbMoveToTrash: "\u79FB\u5230\u56DE\u6536\u7AD9",
      pwbRestore: "\u6062\u590D\u8349\u7A3F",
      pwbStart: "\u5F00\u59CB\u5904\u7406",
      pwbArchitecture: "\u67B6\u6784\u56FE",
      pwbGenerating: "\u6B63\u5728\u751F\u6210 {name}",
      pwbStopping: "\u6B63\u5728\u505C\u6B62 {name} \u751F\u6210",
      pwbGenerationCount: "{n} \u9879\u8D44\u6599\u6B63\u5728\u751F\u6210",
      pwbResourceReady: "{name} \u5DF2\u751F\u6210",
      pwbOpenResource: "\u6253\u5F00 {name}",
      pwbResourceIdle: "{name} \u5C1A\u672A\u751F\u6210"
    },
    en: {
      workbenchMention: "Use Project Workbench in this workspace",
      workbenchHint: "Type /pwb for commands, or start a message with @workbench.",
      workbenchConversation: "Project Workbench in chat",
      openWorkbenchObject: "View in Workbench",
      openAcceptance: "Open task and acceptance",
      removePrompt: "Move this draft to Trash?",
      restorePrompt: "Restore this draft to the requirement pool?",
      startPrompt: "Start this task?",
      prdMarkdown: "PRD draft (Markdown)",
      prds: "Related PRDs",
      savePrd: "Save PRD",
      checkPrdVersion: "Review the saved version",
      prdBefore: "Changed lines in the saved version",
      prdAfter: "Changed lines in the draft",
      prdDiff: "Compare versions",
      noPrdDiff: "No content changes",
      pwbCheckPassed: "Passed",
      pwbCheckFailed: "Failed",
      pwbCheckIncomplete: "Unverified",
      pwbConfirm: "Confirm",
      pwbCancel: "Cancel",
      pwbDismiss: "Dismiss",
      pwbRetry: "Retry",
      pwbPrdReady: "PRD draft ready",
      pwbPreviewPrd: "Preview and save",
      pwbDiscardPrd: "Discard draft",
      pwbPrdSaved: "PRD saved",
      pwbOpenPrd: "View PRD",
      pwbPreviewAction: "Review and confirm",
      pwbDetails: "View details",
      pwbReviewDetails: "Review acceptance",
      pwbMoveToTrash: "Move to Trash",
      pwbRestore: "Restore draft",
      pwbStart: "Start task",
      pwbArchitecture: "architecture diagram",
      pwbGenerating: "Generating {name}",
      pwbStopping: "Stopping {name} generation",
      pwbGenerationCount: "{n} items generating",
      pwbResourceReady: "{name} ready",
      pwbOpenResource: "Open {name}",
      pwbResourceIdle: "{name} has not been generated"
    }
  };
  var workbenchMentionSource = (t, icon) => ({
    trigger: "@",
    name: "project-workbench",
    order: 20,
    showGroupTitle: false,
    async candidates(_session, req) {
      if (req.quoted || req.position !== "leading" || !"workbench".startsWith(req.query.toLowerCase())) return [];
      return [{ name: "workbench", label: t("panel"), description: t("workbenchMention"), icon }];
    },
    onPick({ candidate }) {
      if (candidate.name !== "workbench") return void 0;
      return { insert: { source: "project-workbench", ref: "workbench", label: "@workbench", clipboardText: "@workbench:" } };
    },
    codec: {
      clipboardText: () => "@workbench:",
      serialize: async () => "@workbench:"
    }
  });
  function openConversationTarget(card, workspaces, uiMemory2, openMain) {
    if (!card.root) return;
    const workspace = workspaces.find((item) => item.path === card.root);
    const id = workspace ? projectIdOf(workspace) : null;
    const key = id ? "id:" + id : "path:" + card.root;
    uiMemory2.picked = { id, path: card.root };
    const view = normalizeViewState(uiMemory2.views[key]);
    if (card.reqId) uiMemory2.views[key] = openDetail(view, {
      reqId: card.reqId,
      issueId: card.issueId ?? null,
      ...card.prdId && { prdId: card.prdId }
    }, statusPage(card.status ?? "backlog"));
    else if (card.type) uiMemory2.views[key] = { ...view, page: card.type === "wiki" ? "wiki" : "arch", params: null, history: [] };
    else uiMemory2.views[key] = view;
    openMain();
  }
  function relevantEvent(entry) {
    if (entry.type !== "event") return false;
    const { type, data } = entry.event;
    return type === "turn/end" || type === "tool/result" || type === "tool/ptc-dispatch" || type === "command/run" && data?.name?.startsWith("pwb-") || type === "command/done";
  }
  function ConversationDock(props) {
    return h21(SessionConversationDock, { ...props, key: props.sessionId });
  }
  function SessionConversationDock({ sessionId, eventSource, t, useWorkspaces, openMain, enterSession, uiMemory: uiMemory2, css: css2 }) {
    const [cards, setCards] = useState13([]);
    const [error, setError] = useState13(null);
    const [toast, setToast] = useState13(null);
    const shown = useRef9(/* @__PURE__ */ new Set());
    const generation = useRef9(0);
    const workspaces = (useWorkspaces ?? useNoWorkspaces3)((state) => state?.items) ?? [];
    const refreshRef = useRef9(null);
    useEffect12(() => {
      setError(null);
      let disposed = false;
      let timer;
      let watch;
      const refresh = async () => {
        clearTimeout(watch);
        if (document.hidden || disposed) return;
        const seq = ++generation.current;
        const res = await rpc("conversation/view", { sessionId });
        if (disposed || seq !== generation.current) return;
        if (!res.ok) {
          watch = setTimeout(refresh, 3e3);
          return;
        }
        setCards(res.data.cards);
        const running2 = res.data.cards.some(resourceRunning);
        watch = setTimeout(refresh, running2 ? 1200 : 3e3);
      };
      refreshRef.current = refresh;
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 60);
      };
      const off = eventSource?.subscribe(() => {
        const { change } = eventSource.getSnapshot();
        if (change?.kind === "replace" || change?.kind === "append" && change.entries.some(relevantEvent)) schedule();
      });
      document.addEventListener("visibilitychange", schedule);
      refresh();
      return () => {
        disposed = true;
        refreshRef.current = null;
        clearTimeout(timer);
        clearTimeout(watch);
        off?.();
        document.removeEventListener("visibilitychange", schedule);
      };
    }, [sessionId, eventSource]);
    useEffect12(() => {
      const ids = new Set(cards.map((card) => card.id));
      for (const id of shown.current) if (!ids.has(id)) shown.current.delete(id);
      if (toast) return;
      const next = cards.find((card) => isReceipt(card) && !shown.current.has(card.id));
      if (!next) return;
      shown.current.add(next.id);
      setToast(next);
      void rpc("conversation/act", { sessionId, cardId: next.id, action: "dismiss" });
    }, [cards, sessionId, toast]);
    const running = cards.filter(resourceRunning);
    const pending = cards.filter((card) => card.kind !== "resource" && !isReceipt(card));
    const open = (card) => openConversationTarget(card, workspaces, uiMemory2, openMain);
    const perform = async (card, action, extra = {}) => {
      const res = await rpc("conversation/act", { sessionId, cardId: card.id, action, ...extra });
      setError(res.ok ? null : { cardId: card.id, ...res });
      if (refreshRef.current && res.ok && res.data.sessionId) await enterSession(res.data.sessionId);
      await refreshRef.current?.();
      return res;
    };
    const dock = running.length > 0 || pending.length > 0 ? h21(
      "section",
      { className: "pw-conversation", "aria-label": t("workbenchConversation") },
      h21("style", null, css2 + conversationCss),
      pending.map((card) => h21(ConversationAction, {
        key: card.id,
        card,
        t,
        sessionId,
        uiMemory: uiMemory2,
        error: error?.cardId === card.id ? error : null,
        perform,
        open: () => open(card)
      })),
      running.length > 0 && h21(ResourceProgress, { cards: running, t })
    ) : null;
    return h21(
      import_react21.default.Fragment,
      null,
      dock,
      toast && h21(ConversationToast, { key: toast.id, card: toast, t, open: () => open(toast), dismiss: () => setToast(null) })
    );
  }
  function resourceRunning(card) {
    return card.kind === "resource" && generating.has(card.state);
  }
  function isReceipt(card) {
    return card.kind === "resource" ? !resourceRunning(card) : card.kind === "receipt" || card.failed || card.kind === "open" && !!card.message;
  }
  function resourceName(card, t) {
    return card.type === "wiki" ? "Wiki" : t("pwbArchitecture");
  }
  function ConversationToast({ card, t, open, dismiss }) {
    const resource = card.kind === "resource";
    const name = resource ? resourceName(card, t) : null;
    const stopped = resource && card.message === "stopped by user";
    const failed = !stopped && (card.failed || card.state === "failed");
    const canOpen = card.kind === "open" || resource && card.state === "done";
    let message = card.message;
    if (resource && failed) message = generationStartMessage(card, message, (key) => key === message ? message : t(key));
    else if (resource && stopped) message = t("wikiStopped");
    else if (resource && card.state === "done") message = t("pwbResourceReady", { name });
    else if (resource && card.state === "idle") message = t("pwbResourceIdle", { name });
    else if (card.kind === "open" && card.prdId) message = t("pwbPrdSaved");
    const label = resource ? t("pwbOpenResource", { name }) : t(card.prdId ? "pwbOpenPrd" : "openWorkbenchObject");
    return h21(import_dsh_client_ui_primitives.Toast, {
      text: message,
      onDone: dismiss,
      ...failed ? { icon: h21(import_dsh_client_ui_primitives.IconWarningOutlineRegular), holdMs: 6e3 } : (canOpen || card.kind === "receipt" && !card.pending) && { tone: "success" },
      actions: canOpen ? [{ label, prefix: " \xB7 ", onClick: () => {
        dismiss();
        open();
      } }] : void 0
    });
  }
  function ResourceProgress({ cards, t }) {
    const label = (card) => t(card.state === "stopping" ? "pwbStopping" : "pwbGenerating", { name: resourceName(card, t) });
    const spinner = h21("span", { className: "pw-conversation-spinner", "aria-hidden": true });
    if (cards.length === 1) return h21(
      "div",
      { className: "pw-conversation-row pw-conversation-progress", role: "status" },
      spinner,
      h21("span", null, label(cards[0]))
    );
    return h21(
      "details",
      { className: "pw-conversation-group" },
      h21(
        "summary",
        { className: "pw-conversation-row pw-conversation-progress" },
        spinner,
        h21("span", { role: "status" }, t("pwbGenerationCount", { n: cards.length }))
      ),
      h21("ul", null, cards.map((card) => h21("li", { key: card.id }, label(card))))
    );
  }
  function ConversationAction({ card, t, sessionId, uiMemory: uiMemory2, error, perform, open }) {
    const isPrd = card.kind === "prd";
    const canConfirm = Object.hasOwn(confirmActions, card.kind);
    const drafts = uiMemory2.drafts ??= {};
    const draftKey = "conversation-prd:" + sessionId;
    const [expanded, setExpanded] = useState13(false);
    const [busy, setBusy] = useState13(false);
    const [markdown, setMarkdown] = useState13(() => isPrd && drafts[draftKey]?.id === card.id ? drafts[draftKey].markdown : card.markdown ?? "");
    const [reason, setReason] = useState13("");
    const launch = async (action, extra) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await perform(card, action, extra);
        if (res.ok && action === "openTask") setExpanded(false);
        if (res.ok && isPrd && (action === "confirm" || action === "dismiss") && drafts[draftKey]?.id === card.id) {
          delete drafts[draftKey];
        }
      } finally {
        setBusy(false);
      }
    };
    const close = () => {
      if (!busy) setExpanded(false);
    };
    const confirmation = confirmPrompts[card.kind];
    const direct = card.kind === "open" || card.kind === "openTask" && !card.evidence;
    const label = isPrd ? "pwbPreviewPrd" : card.kind === "open" ? "openWorkbenchObject" : direct ? "openAcceptance" : canConfirm ? "pwbPreviewAction" : card.evidence ? "pwbReviewDetails" : "pwbDetails";
    const row = h21(
      "div",
      { className: "pw-conversation-row" },
      h21("span", { className: "pw-conversation-label", title: card.title }, isPrd ? t("pwbPrdReady") : card.title),
      h21(import_dsh_client_ui_primitives.Button, {
        size: "sm",
        disabled: busy,
        "aria-haspopup": direct ? void 0 : "dialog",
        onClick: card.kind === "open" ? open : direct ? () => launch("openTask") : () => setExpanded(true)
      }, t(label)),
      !isPrd && h21(import_dsh_client_ui_primitives.Button, {
        size: "sm",
        disabled: busy,
        "aria-label": t("pwbDismiss"),
        title: t("pwbDismiss"),
        icon: h21(import_dsh_client_ui_primitives.IconCloseOutlineRegular, { size: 14, "aria-hidden": true }),
        onClick: () => launch("dismiss")
      }),
      !expanded && error && h21("p", { role: "alert", className: "pw-error" }, error.message)
    );
    if (!expanded) return row;
    const footer = h21(
      import_react21.default.Fragment,
      null,
      isPrd && error?.code === "PRD_CONFLICT" && card.previous !== void 0 && h21(import_dsh_client_ui_primitives.Button, { disabled: busy, onClick: () => launch("reloadPrd") }, t("checkPrdVersion")),
      h21(
        import_dsh_client_ui_primitives.Button,
        { disabled: busy, onClick: canConfirm ? () => launch("dismiss") : close },
        t(isPrd ? "pwbDiscardPrd" : canConfirm ? "pwbCancel" : "pwbDismiss")
      ),
      card.kind === "openTask" && h21(import_dsh_client_ui_primitives.Button, { variant: "primary", disabled: busy, onClick: () => launch("openTask") }, t("openAcceptance")),
      canConfirm && h21(import_dsh_client_ui_primitives.Button, {
        variant: "primary",
        disabled: busy || isPrd && !markdown.trim() || card.kind === "reviewEdit" && !reason.trim(),
        onClick: () => launch("confirm", { ...isPrd && { markdown }, ...card.kind === "reviewEdit" && { reason } })
      }, t(confirmActions[card.kind]))
    );
    return h21(
      import_react21.default.Fragment,
      null,
      row,
      h21(
        import_dsh_client_ui_primitives.Modal,
        {
          open: expanded,
          onClose: close,
          title: card.title,
          closeLabel: t("pwbDismiss"),
          footer,
          className: "pw-conversation-dialog" + (isPrd ? " pw-prd-editor" : ""),
          contentClassName: "pw-conversation-dialog-content",
          tone: card.kind === "remove" ? "warning" : void 0,
          description: isPrd ? card.requirements.join(" \xB7 ") : confirmation ? t(confirmation) : card.evidence || canConfirm ? card.message : void 0
        },
        card.kind === "note" && h21("p", null, card.message),
        card.evidence && h21(TaskEvidence, { data: card.evidence, t }),
        card.kind === "reviewEdit" && h21(
          import_react21.default.Fragment,
          null,
          h21("p", null, t("confirmReviewEditBody")),
          h21("ul", null, card.changes.map(({ label: label2, value }) => h21("li", { key: label2 }, label2, " \xB7 ", value))),
          h21(
            "label",
            { className: "pw-field" },
            h21("span", null, t("reasonTitle")),
            h21("input", { className: "pw-input", value: reason, onChange: (event) => setReason(event.target.value) })
          )
        ),
        isPrd && h21(
          import_react21.default.Fragment,
          null,
          h21(
            "label",
            { className: "pw-field" },
            h21("span", null, t("prdMarkdown")),
            h21("textarea", { className: "pw-textarea", rows: 10, value: markdown, onChange: (event) => {
              setMarkdown(event.target.value);
              drafts[draftKey] = { id: card.id, markdown: event.target.value };
            } })
          ),
          card.previous !== void 0 && h21(PrdDiff, { before: card.previous, after: markdown, t })
        ),
        error && h21("p", { role: "alert", className: "pw-error" }, error.message)
      )
    );
  }
  function TaskEvidence({ data, t }) {
    const { verification, currentEvidence } = data;
    const counts = verification && t("checksPassed", { n: verification.passed }) + " \xB7 " + t("checksFailed", { n: verification.failed });
    const outcomeLabels = { passed: "pwbCheckPassed", failed: "pwbCheckFailed", incomplete: "pwbCheckIncomplete" };
    return h21(
      "details",
      { open: true },
      h21("summary", null, t("verify")),
      h21("p", null, t("acceptanceField"), " \xB7 ", data.acceptance || t("noLimits")),
      counts && h21("p", null, counts),
      verification?.status === "unverified" && h21("p", null, t("noChecks")),
      (verification?.incomplete > 0 || verification?.unconfirmedChanges > 0) && h21("p", null, t("checksIncomplete")),
      data.currentLimits && h21("p", null, data.currentLimits),
      data.checks?.length > 0 && h21("ul", null, data.checks.map((check) => h21("li", { key: check.command }, t(outcomeLabels[check.status]), " \xB7 ", h21("code", null, check.command), " \xB7 ", check.outcome))),
      currentEvidence && h21("pre", null, currentEvidence)
    );
  }
  function changedLines(before, after) {
    const a = before.trim().split(/\r?\n/), b = after.trim().split(/\r?\n/);
    let start = 0;
    let end = 0;
    const min = Math.min(a.length, b.length);
    while (start < min && a[start] === b[start]) start++;
    while (end < min - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    return [a.slice(start, a.length - end).join("\n"), b.slice(start, b.length - end).join("\n")];
  }
  function PrdDiff({ before, after, t }) {
    const [removed, added] = changedLines(before, after);
    return h21(
      "details",
      { className: "pw-prd-diff", open: true },
      h21("summary", null, t("prdDiff")),
      !removed && !added ? h21("p", null, t("noPrdDiff")) : h21(
        "div",
        { className: "pw-prd-diff-columns" },
        h21("div", null, h21("span", null, t("prdBefore")), h21("pre", null, removed)),
        h21("div", null, h21("span", null, t("prdAfter")), h21("pre", null, added))
      )
    );
  }
  var conversationCss = [
    ".pw-conversation{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width,920px);margin:0 auto 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px}",
    ".pw-conversation>*+*{border-top:1px solid var(--dsw-alias-border-l3)}.pw-conversation>style+*{border-top:0}",
    ".pw-conversation-row{display:flex;align-items:center;gap:8px;min-height:34px;padding:2px 10px}",
    ".pw-conversation-label{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    ".pw-conversation-row .pw-error{overflow-wrap:anywhere}",
    ".pw-conversation-progress{font-size:inherit}.pw-conversation-group>summary{cursor:pointer;display:list-item;list-style-position:inside;padding-block:8px;min-height:0}",
    ".pw-conversation-group>summary .pw-conversation-spinner{display:inline-block;margin:0 6px;vertical-align:-1px}",
    ".pw-conversation-group ul{margin:0;padding:0 12px 8px 32px;line-height:1.6}",
    ".pw-conversation-spinner{flex:none;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:pw-conversation-spin .85s linear infinite}",
    "@keyframes pw-conversation-spin{to{transform:rotate(1turn)}}",
    "@media(prefers-reduced-motion:reduce){.pw-conversation-spinner{animation:none}}",
    ".pw-conversation-dialog.pw-conversation-dialog{width:min(560px,100%);max-height:100%;font-size:14px}",
    ".pw-conversation-dialog.pw-prd-editor{width:min(720px,100%)}",
    ".pw-conversation-dialog-content{min-height:0;overflow:auto}",
    ".pw-conversation-dialog p,.pw-conversation-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0}",
    ".pw-conversation-dialog li{overflow-wrap:anywhere}",
    ".pw-prd-diff-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:12px}",
    ".pw-conversation-dialog details pre{max-height:150px;overflow:auto}",
    ".pw-conversation-dialog .pw-field{display:block}.pw-conversation-dialog textarea{box-sizing:border-box;max-height:40vh}"
  ].join("\n");

  // client-src/index.js
  var h22 = import_react22.default.createElement;
  var NS = "projectWorkbench";
  var PANEL_ID = "project-workbench";
  var en = {
    ...workbenchContentLocale.en,
    ...rightbarLocale.en,
    ...acceptanceAssistLocale.en,
    ...conversationLocale.en,
    requirementActions: "More options",
    resumeReopen: "Resume reopening",
    reopenProgress: "{done} of {total} tasks prepared",
    confirmIssueTitle: "Confirm task completion",
    edit: "Edit",
    taskNotes: "Task notes",
    history: "View history",
    olderProgress: "View earlier updates",
    rawDetails: "View original record",
    verify: "Verification",
    verifyRecords: "View verification records",
    previousResult: "Previous result",
    latestSupplement: "Latest addition",
    fullResult: "Full result",
    checksPassed: "{n} checks passed",
    checksFailed: "{n} checks failed",
    checksIncomplete: "Some check results are unverified",
    noChecks: "No completed check recorded for this round",
    manualEvidence: "There is a manual verification record",
    unconfirmedChanges: "Some changes have not been verified",
    noLimits: "Not recorded",
    limitsUnverified: "Earlier limits have not been checked this round",
    previousResultUnverified: "Previous result (round not verified)",
    previousLimits: "Earlier limits (not checked this round)",
    goal: "Goal",
    scope: "What this covers",
    problemOverview: "What happens",
    triggerPath: "How to see it",
    rootCause: "Why it happens",
    acceptanceField: "How to check it",
    taskCount: "{done} of {total} tasks confirmed",
    cancelledCount: "{n} tasks cancelled",
    fullRequirement: "Read the full requirement",
    openTaskSession: "Open task conversation",
    noLinkedTask: "Choose a task in this project",
    linkTask: "Link and view",
    pickTask: "Choose a task",
    aiOrganize: "Let AI organize this requirement",
    aiSplit: "Let AI suggest tasks",
    draftUnavailable: "No draft is ready. Add details or try again.",
    draftMissing: "Please add: {fields}",
    submitReview: "Send for review",
    approveReview: "Approve review",
    returnReview: "Return for edits",
    startDev: "Start development",
    col_reviewing: "In review",
    col_ready: "Ready for development",
    reviewHistory: "Review and acceptance history",
    acceptRequirement: "Accept delivery",
    reviewApproved: "Review approved",
    reviewReturned: "Review returned",
    deliveryAccepted: "Delivery accepted",
    deliveryReturned: "Delivery returned",
    confirmReviewEdit: "Save and return to the requirement pool",
    confirmReviewEditBody: "This change needs another review. Enter a reason.",
    notCompletedTask: "Unfinished task",
    continuedWork: "Continue editing",
    deliveredTaskResults: "Task results",
    sendBack: "Send back for changes",
    reviseTask: "Request changes",
    askFix: "What should be changed?",
    pickReopen: "Choose at least one task to reopen",
    unknownRun: "The conversation status is unavailable.",
    runIdle: "AI is idle",
    runRunning: "AI is working",
    runWaiting: "Waiting for permission",
    runStarting: "AI is starting",
    runUncertain: "Checking whether AI started",
    linkMissing: "The linked task is unavailable. Choose another task.",
    switchTask: "Switch task",
    noEvidenceYet: "No verification record yet",
    oldEvidence: "Previous verification records",
    startTask: "Start task",
    panel: "Project workbench",
    title: "Project workbench",
    back: "Back to conversation",
    switchWorkspace: "Switch workspace",
    chooseWorkspace: "Choose a workspace",
    chooseWorkspaceHint: "Each workspace is one project. Pick one to open its board.",
    openRight: "Open in right sidebar",
    openMain: "Open main panel",
    openRequirement: "View parent requirement",
    fallbackDescription: "Open the project workbench in the right sidebar",
    noWorkspace: "Select a session with a working directory first.",
    loading: "Loading\u2026",
    retry: "Retry",
    noWorkspacesHint: "No workspaces yet. Add or open a workspace in DSH first, then pick it here.",
    workspaceRemoved: "This workspace is no longer registered in DSH. Select another workspace or add it again.",
    readFailedTitle: "Cannot read this project",
    readFailedHint: "The project data could not be read. You can switch projects or retry; nothing is written.",
    dataProblems: "{n} data issue(s)",
    details: "Details",
    retryRead: "Retry read",
    diagWorkspace: "This workspace could not be opened. Check that the folder is accessible in DSH.",
    diagUnreadable: "Some project records could not be read.",
    diagVersion: "Some records need a newer version of the workbench.",
    diagReference: "Some references are outside the workspace. Update them to point to project documents.",
    diagBlocked: "Some blocked tasks are missing a reason.",
    diagInconsistent: "Some requirement or task records are incomplete or inconsistent.",
    diagLarge: "The project has many tasks and may take longer to load.",
    conflict: "This file has changed. Copy any edits you want to keep, retry the read, then discard this draft and reopen the form.",
    saveFailed: "Save failed; your input is kept, retry when ready.",
    leaveTitle: "Unsaved changes",
    leaveBody: "This form has unsaved changes. Save them before leaving?",
    saveAndLeave: "Save and leave",
    discardDraft: "Discard changes",
    keepEditing: "Keep editing",
    initTitle: "Enable project management",
    initBody: "Store requirements and tasks for this workspace.",
    newRequirement: "New requirement",
    search: "Search",
    saving: "Saving\u2026",
    col_backlog: "Backlog",
    col_in_progress: "In progress",
    col_pending: "Pending review",
    col_completed: "Completed",
    completedToggle: "Completed {n}",
    empty: "Nothing here yet",
    progress: "progress",
    flag_blocked: "Blocked",
    flag_clarify: "Needs clarity",
    flag_stalled: "Stalled",
    flag_submittable: "Ready to submit",
    flag_acceptable: "Awaiting review",
    start: "Start",
    submit: "Submit for review",
    confirm: "Confirm complete",
    rework: "Send back",
    freeze: "Freeze",
    delete: "Delete",
    reasonTitle: "A reason is required",
    reasonPlaceholder: "Why? (one line)",
    cancel: "Cancel",
    ok: "OK",
    moveRejectedTitle: "Move not allowed",
    confirmCompleteTitle: "Confirm completion",
    confirmCompleteBody: "This is the one sign-off. All issues must be done or cancelled.",
    abandonTitle: "Abandon open issues",
    abandonBody: "{n} issue(s) are not finished. Cancelling them requires a reason; the requirement will then be completed.",
    deleteTitle: "Delete requirement",
    deleteBody: 'Move "{title}" and its {n} issue(s) to the trash? This is reversible from .local/trash.',
    detail: "Requirement",
    next: "Next step",
    q_who: "Intended users",
    q_success: "Other completion conditions",
    q_out: "Out of scope",
    activity: "Activity",
    noActivity: "No activity yet",
    updates: "Updates",
    updatePlaceholder: "Add an update\u2026",
    addUpdate: "Post update",
    issues: "Issues",
    addIssue: "Add an issue\u2026",
    issueLocked: "Issues can only be added while in progress",
    issueTitle: "Title",
    acceptance: "Acceptance",
    evidence: "Evidence",
    editIssue: "Edit issue",
    save: "Save",
    description: "Description",
    refs: "References",
    created: "Created",
    updated: "Updated",
    issueDetail: "Issue detail",
    noRefs: "No references yet",
    addRef: "Add",
    addRefPlaceholder: "e.g. src/core/store.js or openwiki/data/store.md",
    removeRef: "Remove reference",
    st_todo: "To do",
    st_doing: "Doing",
    st_blocked: "Blocked",
    st_in_review: "Awaiting acceptance",
    st_done: "Done",
    st_cancelled: "Cancelled",
    blockedReason: "Blocked reason",
    today: "Today",
    current: "Currently doing",
    openIssue: "Open",
    sug_submittable: "Ready to submit for review",
    sug_blocked: "Has a blocked issue",
    sug_currentDoing: "Keep going on the current issue",
    sug_needsClarification: "Needs a little clarity",
    sug_stalled: "Has been idle a while",
    errGeneric: "Something went wrong",
    noSession: "No session selected",
    undo: "Undo",
    trashed: "Moved to trash",
    dismiss: "Dismiss",
    restored: "Restored",
    markDone: "Done",
    block: "Block",
    unblock: "Resume",
    reopen: "Reopen",
    expand: "Expand",
    collapse: "Collapse",
    bind: "Session \u2192 requirement",
    unbound: "Not bound",
    bindWorkspace: "Session \u2192 this workspace",
    commit: "Commit .project",
    uncommitted: "{n} uncommitted",
    committed: "Committed",
    gitUnavailable: "git unavailable",
    viewBoard: "Board",
    viewWiki: "Wiki",
    viewSync: "Proposals",
    viewArch: "Architecture",
    wikiTitle: "Project Wiki",
    wikiEmpty: "No wiki yet. Generate one.",
    wikiPages: "Pages",
    wikiLastUpdate: "Last update",
    wikiDateUnknown: "Date unavailable",
    mermaidNote: "Mermaid diagram (source)",
    wikiBack: "Back to pages",
    copy: "Copy",
    copied: "Copied",
    wikiEvidence: "Source evidence",
    wikiNoEvidence: "No source records for this page.",
    wikiUnavailable: "This source cannot be opened. Check that it is available, then retry.",
    archTitle: "Architecture",
    archGenerate: "Generate diagram",
    archRegenerate: "Regenerate",
    archEmpty: "No architecture diagram yet. Generate one from the project source code.",
    archAuthoring: "Reading source code and drawing the diagram\u2026",
    archRendering: "Generating diagram\u2026",
    archRepairing: "Refining layout\u2026",
    archDone: "Architecture diagram ready.",
    archHint: "Auto-generated from the project source",
    syncTitle: "Reconciliation proposals",
    syncRun: "Review progress",
    syncRunning: "Collecting evidence\u2026",
    syncDone: "Progress review finished.",
    syncNone: "The review found no changes to suggest.",
    syncEmpty: "No pending suggestions. Review progress to check for updates.",
    syncDismiss: "Dismiss",
    syncEvidence: "Sources",
    syncSaved: "{n} new proposals",
    syncPending: "{n} pending",
    syncAcceptRate: "Acceptance rate: {rate}% ({accepted}/{total})",
    kind_advance: "Advance state",
    kind_review: "Review state",
    kind_capture: "Capture new work",
    kind_clarify: "Needs clarification",
    kind_stalled: "Stalled",
    kind_wiki_drift: "Wiki drift",
    wikiTryAgain: "Wiki generation did not finish. You can try again.",
    wikiStagingFailed: "Could not prepare the temporary copy. Check the project and file permissions, then try again.",
    wikiSourceUnsupported: "This project uses a Git worktree, submodules, symbolic links, or a Git index that Wiki generation does not support.",
    wikiShowingPrevious: "Showing the Wiki saved before this update.",
    wikiPreviousUnavailable: "The unfinished update has no saved earlier version; these pages may have changed.",
    wikiSnapshotFailed: "Could not safely save the Wiki. Check file permissions, metadata, size and system support before retrying.",
    wikiSnapshotUnreadable: "The saved Wiki version cannot be read safely. The update was not started.",
    wikiSavedViewUnreadable: "The saved Wiki version is missing or damaged and cannot be read safely.",
    wikiExternalChangeView: "The current Wiki changed or cannot be verified. Showing an earlier saved version.",
    wikiNoSavedExternal: "The Wiki changed or cannot be verified, and no earlier saved version is available.",
    wikiExternalChangeBlocked: "The current Wiki changed or cannot be verified. Check its update state before starting another update.",
    wikiRootNotTopLevel: "Open the Git repository\u2019s top-level folder as the project before generating a wiki.",
    wikiNeedsGit: "Wiki generation requires a Git repository. Initialize Git in this project and try again. You can commit later.",
    wikiGitMissing: "Git is unavailable. Install Git or check its setup and try again.",
    wikiRootUnavailable: "Cannot read the Git working directory. Check that Git is available and open the repository\u2019s top-level folder with the project files.",
    wikiStateUnreadable: "Cannot safely read the existing Wiki or its unfinished update. Check the files before trying again.",
    wikiMetadataUnsafe: "The Wiki contains system companion files that the generator may misinterpret. Check them before trying again.",
    wikiCheckpointUnsafe: "The unfinished Wiki update lists system companion files as pages. Check the update record before trying again; existing files are preserved.",
    archTryAgain: "The architecture diagram could not be generated. You can try again.",
    archSourceRequired: "No project source could be cited. Check that this project contains readable source files, then try again.",
    archSourceInvalid: "The diagram references a file or line range that cannot be verified. Check the project files and try again.",
    generationNeedsSession: "Open a conversation in this project and try again.",
    generationStatusUnavailable: "The status of this run is unavailable. Try again to check it.",
    generationStopFailed: "The stop request did not complete. You can try again.",
    syncRunFailed: "Project review did not finish. You can try again.",
    syncAdoptContent: "Adopt all content suggestions",
    syncLocateRequirement: "Find on board",
    syncLocateTask: "Find in task list",
    syncSourceConversation: "Task conversation",
    syncSourceDraft: "Drafted from project content",
    syncSourceCommit: "Code change {revision}",
    syncBatchResult: "{adopted} adopted, {failed} could not be adopted",
    kind_req_draft: "Requirement draft",
    kind_field_draft: "Task draft",
    kind_new_task: "New task",
    kind_task_suggestion: "Task suggestion",
    wikiBusy: "Another project is generating its wiki. Wait for it or stop it first.",
    wikiGenerate: "Generate wiki",
    wikiUpdate: "Update wiki",
    wikiStop: "Stop",
    wikiStopping: "Stopping\u2026",
    wikiStopped: "Generation stopped.",
    wikiGenerating: "Generating wiki\u2026 this can take a few minutes.",
    wikiDone: "Wiki generation finished.",
    wikiNoop: "Wiki is already up to date.",
    wikiProbeOk: "Wiki generation service is available ({n} tools).",
    wikiProbeMissing: "Wiki generation service is unavailable.",
    demoTitle: "Stage-1 prototype demo (temporary entry)",
    demoPrepare: "Prepare demo data",
    demoView: "View",
    demoStart: "Start once",
    demoHint: "View sends no prompt; Start submits exactly one request.",
    demoOpened: "Task session opened.",
    demoTabFallback: "Session opened. Open \u201CProject workbench\u201D in the right sidebar to see the task card.",
    demoStarted: "One processing request submitted.",
    demoAlready: "A request is already running; entering the session to watch progress.",
    demoBusy: "The session is busy with other input; no new request was submitted.",
    demoUncertain: "Submission outcome unclear; the run lock is kept. Retry to verify.",
    demoNoLink: "This session is not linked to a demo task.",
    demoUnrecorded: "This turn may have unrecorded progress.",
    demoNotePlaceholder: "Human progress note\u2026",
    demoNote: "Record (human)",
    demoContinue: "Continue",
    demoStop: "Stop",
    demoRunState: "Run",
    demoCursor: "Recorded to event",
    demoFailed: "Demo action failed",
    demoResult: "Result",
    demoEvidence: "Verification evidence",
    demoAcceptance: "Completion criteria",
    demoLimits: "Known limits",
    demoNoResult: "No result yet",
    demoConfirm: "Accept task",
    submitTaskAcceptance: "Submit task for acceptance",
    demoDrafts: "Pending drafts",
    demoAdopt: "Adopt",
    demoDismiss: "Dismiss",
    demoDeliveryFailed: "Summary generation failed",
    demoManualSummary: "Write a delivery summary\u2026",
    demoSubmitAcceptance: "Submit for acceptance",
    demoDeliverySummary: "Delivery summary",
    demoPendingAcceptance: "Awaiting acceptance",
    demoCancelImpact: "Cancelled scope impact"
  };
  var zh = {
    ...workbenchContentLocale.zh,
    ...rightbarLocale.zh,
    ...acceptanceAssistLocale.zh,
    ...conversationLocale.zh,
    requirementActions: "\u66F4\u591A\u9009\u9879",
    resumeReopen: "\u7EE7\u7EED\u91CD\u5F00",
    reopenProgress: "\u5DF2\u5904\u7406 {done}/{total} \u9879\u4EFB\u52A1",
    confirmIssueTitle: "\u786E\u8BA4\u4EFB\u52A1\u5B8C\u6210",
    edit: "\u7F16\u8F91",
    taskNotes: "\u67E5\u770B\u4EFB\u52A1\u8BF4\u660E",
    history: "\u67E5\u770B\u5386\u53F2",
    olderProgress: "\u67E5\u770B\u8F83\u65E9\u8FDB\u5C55",
    rawDetails: "\u67E5\u770B\u539F\u59CB\u8BB0\u5F55",
    verify: "\u9A8C\u8BC1\u60C5\u51B5",
    verifyRecords: "\u67E5\u770B\u9A8C\u8BC1\u8BB0\u5F55",
    previousResult: "\u4E4B\u524D\u7684\u7ED3\u679C",
    latestSupplement: "\u6700\u8FD1\u8865\u5145",
    fullResult: "\u5B8C\u6574\u7ED3\u679C",
    checksPassed: "{n} \u9879\u68C0\u67E5\u901A\u8FC7",
    checksFailed: "{n} \u9879\u68C0\u67E5\u672A\u901A\u8FC7",
    checksIncomplete: "\u6709\u68C0\u67E5\u7ED3\u679C\u5C1A\u672A\u6838\u5B9E",
    noChecks: "\u672C\u8F6E\u5C1A\u65E0\u5DF2\u5B8C\u6210\u7684\u68C0\u67E5\u8BB0\u5F55",
    manualEvidence: "\u6709\u4EBA\u5DE5\u9A8C\u8BC1\u8BB0\u5F55",
    unconfirmedChanges: "\u6709\u6539\u52A8\u4ECD\u5F85\u6838\u5B9E",
    noLimits: "\u672A\u586B\u5199",
    limitsUnverified: "\u6B64\u524D\u8BB0\u5F55\u7684\u9650\u5236\u672C\u8F6E\u5C1A\u672A\u6838\u5B9E",
    previousResultUnverified: "\u6B64\u524D\u7ED3\u679C\uFF08\u8F6E\u6B21\u672A\u6838\u5B9E\uFF09",
    previousLimits: "\u6B64\u524D\u7684\u9650\u5236\uFF08\u672C\u8F6E\u672A\u6838\u5B9E\uFF09",
    goal: "\u76EE\u6807",
    scope: "\u8FD9\u6B21\u5305\u62EC\u4EC0\u4E48",
    problemOverview: "\u9047\u5230\u4E86\u4EC0\u4E48",
    triggerPath: "\u600E\u6837\u9047\u5230\u8FD9\u4E2A\u95EE\u9898",
    rootCause: "\u4E3A\u4EC0\u4E48\u4F1A\u53D1\u751F",
    acceptanceField: "\u600E\u4E48\u77E5\u9053\u505A\u597D\u4E86",
    taskCount: "{total} \u4E2A\u4EFB\u52A1\uFF0C{done} \u4E2A\u5DF2\u786E\u8BA4\u5B8C\u6210",
    cancelledCount: "{n} \u4E2A\u4EFB\u52A1\u5DF2\u53D6\u6D88",
    fullRequirement: "\u67E5\u770B\u5B8C\u6574\u9700\u6C42",
    openTaskSession: "\u6253\u5F00\u4EFB\u52A1\u4F1A\u8BDD",
    noLinkedTask: "\u9009\u62E9\u4E00\u4E2A\u4EFB\u52A1\uFF0C\u65B9\u4FBF\u5728\u4F1A\u8BDD\u91CC\u67E5\u770B\u8FDB\u5C55\u3002",
    linkTask: "\u5173\u8054\u5E76\u67E5\u770B",
    pickTask: "\u9009\u62E9\u4EFB\u52A1",
    aiOrganize: "\u8BA9 AI \u6574\u7406\u9700\u6C42",
    aiSplit: "\u8BA9 AI \u5EFA\u8BAE\u4EFB\u52A1",
    draftUnavailable: "\u8FD8\u6CA1\u6709\u53EF\u7528\u7684\u8349\u7A3F\u3002\u53EF\u4EE5\u8865\u5145\u8BF4\u660E\u540E\u91CD\u8BD5\u3002",
    draftMissing: "\u8FD8\u9700\u8981\u8865\u5145 {fields}",
    submitReview: "\u9001\u53BB\u8BC4\u5BA1",
    approveReview: "\u901A\u8FC7\u8BC4\u5BA1",
    returnReview: "\u9000\u56DE\u8865\u5145",
    startDev: "\u5F00\u59CB\u5F00\u53D1",
    col_reviewing: "\u8BC4\u5BA1\u4E2D",
    col_ready: "\u5F85\u5F00\u53D1",
    reviewHistory: "\u67E5\u770B\u8BC4\u5BA1\u548C\u9A8C\u6536\u5386\u53F2",
    acceptRequirement: "\u9A8C\u6536\u901A\u8FC7",
    reviewApproved: "\u8BC4\u5BA1\u901A\u8FC7",
    reviewReturned: "\u8BC4\u5BA1\u9000\u56DE",
    deliveryAccepted: "\u9A8C\u6536\u901A\u8FC7",
    deliveryReturned: "\u9A8C\u6536\u6253\u56DE",
    confirmReviewEdit: "\u4FDD\u5B58\u5E76\u9000\u56DE\u9700\u6C42\u6C60",
    confirmReviewEditBody: "\u672C\u6B21\u4FEE\u6539\u9700\u8981\u91CD\u65B0\u8BC4\u5BA1\u3002\u8BF7\u8BF4\u660E\u539F\u56E0\u3002",
    notCompletedTask: "\u672A\u5B8C\u6210\u7684\u4EFB\u52A1",
    deliveredTaskResults: "\u5404\u9879\u4EFB\u52A1\u7ED3\u679C",
    sendBack: "\u9A73\u56DE\u8FD4\u5DE5",
    reviseTask: "\u7EE7\u7EED\u4FEE\u6539",
    askFix: "\u54EA\u91CC\u8FD8\u9700\u8981\u4FEE\u6539\uFF1F",
    pickReopen: "\u9009\u62E9\u81F3\u5C11\u4E00\u9879\u9700\u8981\u91CD\u65B0\u5904\u7406\u7684\u4EFB\u52A1",
    unknownRun: "\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u4F1A\u8BDD\u72B6\u6001",
    runIdle: "AI \u6682\u672A\u8FD0\u884C",
    runRunning: "AI \u6B63\u5728\u5904\u7406",
    runWaiting: "\u7B49\u4F60\u5728\u4F1A\u8BDD\u4E2D\u6388\u6743",
    runStarting: "\u6B63\u5728\u5F00\u59CB\u5904\u7406",
    runUncertain: "\u6B63\u5728\u6838\u5BF9\u662F\u5426\u5DF2\u5F00\u59CB\u5904\u7406",
    linkMissing: "\u539F\u4EFB\u52A1\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\uFF0C\u53EF\u4EE5\u9009\u62E9\u5176\u4ED6\u4EFB\u52A1\u3002",
    switchTask: "\u66F4\u6362\u4EFB\u52A1",
    noEvidenceYet: "\u6682\u65E0\u9A8C\u8BC1\u8BB0\u5F55",
    oldEvidence: "\u4E4B\u524D\u7684\u9A8C\u8BC1\u8BB0\u5F55",
    startTask: "\u5F00\u59CB\u5904\u7406",
    panel: "\u9879\u76EE\u5DE5\u4F5C\u53F0",
    title: "\u9879\u76EE\u5DE5\u4F5C\u53F0",
    back: "\u8FD4\u56DE\u4F1A\u8BDD",
    switchWorkspace: "\u5207\u6362\u5DE5\u4F5C\u533A",
    chooseWorkspace: "\u9009\u62E9\u8981\u67E5\u770B\u7684\u5DE5\u4F5C\u533A",
    chooseWorkspaceHint: "\u6BCF\u4E2A\u5DE5\u4F5C\u533A\u5C31\u662F\u4E00\u4E2A\u9879\u76EE\u3002\u9009\u4E00\u4E2A\u8FDB\u5165\uFF0C\u67E5\u770B\u5B83\u7684\u770B\u677F\u3002",
    openRight: "\u5728\u53F3\u680F\u6253\u5F00",
    openMain: "\u6253\u5F00\u4E3B\u9762\u677F",
    openRequirement: "\u67E5\u770B\u6240\u5C5E\u9700\u6C42",
    fallbackDescription: "\u5728\u53F3\u680F\u6253\u5F00\u9879\u76EE\u5DE5\u4F5C\u53F0",
    noWorkspace: "\u8BF7\u5148\u9009\u62E9\u4E00\u4E2A\u5E26\u5DE5\u4F5C\u76EE\u5F55\u7684\u4F1A\u8BDD\u3002",
    loading: "\u52A0\u8F7D\u4E2D\u2026",
    retry: "\u91CD\u8BD5",
    noWorkspacesHint: "\u6682\u65E0\u5DE5\u4F5C\u533A\u3002\u8BF7\u5148\u5728 DSH \u4E2D\u6DFB\u52A0\u6216\u6253\u5F00\u4E00\u4E2A\u5DE5\u4F5C\u533A\uFF0C\u518D\u56DE\u5230\u8FD9\u91CC\u9009\u62E9\u9879\u76EE\u3002",
    workspaceRemoved: "\u6B64\u5DE5\u4F5C\u533A\u5DF2\u4ECE DSH \u79FB\u9664\u3002\u8BF7\u9009\u62E9\u5176\u4ED6\u5DE5\u4F5C\u533A\uFF0C\u6216\u5728 DSH \u4E2D\u91CD\u65B0\u6DFB\u52A0\u3002",
    readFailedTitle: "\u65E0\u6CD5\u8BFB\u53D6\u8FD9\u4E2A\u9879\u76EE",
    readFailedHint: "\u9879\u76EE\u6570\u636E\u8BFB\u53D6\u5931\u8D25\u3002\u53EF\u4EE5\u5207\u6362\u9879\u76EE\u6216\u91CD\u8BD5\u8BFB\u53D6\uFF1B\u6B64\u64CD\u4F5C\u4E0D\u4F1A\u5199\u5165\u4EFB\u4F55\u6587\u4EF6\u3002",
    dataProblems: "{n} \u9879\u6570\u636E\u95EE\u9898",
    details: "\u8BE6\u60C5",
    retryRead: "\u91CD\u8BD5\u8BFB\u53D6",
    diagWorkspace: "\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\u6B64\u5DE5\u4F5C\u533A\u3002\u8BF7\u68C0\u67E5 DSH \u4E2D\u80FD\u5426\u8BBF\u95EE\u8BE5\u6587\u4EF6\u5939\u3002",
    diagUnreadable: "\u90E8\u5206\u9879\u76EE\u8BB0\u5F55\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u3002",
    diagVersion: "\u90E8\u5206\u8BB0\u5F55\u9700\u8981\u66F4\u65B0\u7248\u672C\u7684\u5DE5\u4F5C\u53F0\u624D\u80FD\u8BFB\u53D6\u3002",
    diagReference: "\u90E8\u5206\u5173\u8054\u8D44\u6599\u4F4D\u4E8E\u5DE5\u4F5C\u533A\u4E4B\u5916\uFF0C\u53EF\u4EE5\u6539\u4E3A\u5F15\u7528\u9879\u76EE\u5185\u7684\u8D44\u6599\u3002",
    diagBlocked: "\u90E8\u5206\u963B\u585E\u4EFB\u52A1\u8FD8\u6CA1\u6709\u8BB0\u5F55\u539F\u56E0\u3002",
    diagInconsistent: "\u90E8\u5206\u9700\u6C42\u6216\u4EFB\u52A1\u8BB0\u5F55\u7F3A\u5C11\u4FE1\u606F\uFF0C\u6216\u4E0E\u5F53\u524D\u72B6\u6001\u4E0D\u4E00\u81F4\u3002",
    diagLarge: "\u9879\u76EE\u4E2D\u7684\u4EFB\u52A1\u8F83\u591A\uFF0C\u52A0\u8F7D\u65F6\u95F4\u53EF\u80FD\u66F4\u957F\u3002",
    conflict: "\u5185\u5BB9\u5DF2\u6709\u66F4\u65B0\u3002\u4F60\u7684\u8F93\u5165\u4ECD\u5728\uFF0C\u53EF\u4EE5\u91CD\u65B0\u6838\u5BF9\u540E\u518D\u4FDD\u5B58\u3002",
    saveFailed: "\u4FDD\u5B58\u5931\u8D25\uFF0C\u8F93\u5165\u5DF2\u4FDD\u7559\uFF0C\u53EF\u91CD\u8BD5\u3002",
    leaveTitle: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539",
    leaveBody: "\u5F53\u524D\u8868\u5355\u8FD8\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539\u3002\u79BB\u5F00\u524D\u5148\u4FDD\u5B58\u5417\uFF1F",
    saveAndLeave: "\u4FDD\u5B58\u540E\u79BB\u5F00",
    discardDraft: "\u653E\u5F03\u4FEE\u6539",
    keepEditing: "\u7EE7\u7EED\u7F16\u8F91",
    initTitle: "\u542F\u7528\u9879\u76EE\u7BA1\u7406",
    initBody: "\u5728\u6B64\u5DE5\u4F5C\u533A\u4FDD\u5B58\u9700\u6C42\u548C\u4EFB\u52A1\u3002",
    newRequirement: "\u65B0\u5EFA\u9700\u6C42",
    search: "\u641C\u7D22",
    saving: "\u4FDD\u5B58\u4E2D\u2026",
    col_backlog: "\u9700\u6C42\u6C60",
    col_in_progress: "\u5F00\u53D1\u4E2D",
    col_pending: "\u5F85\u9A8C\u6536",
    col_completed: "\u5DF2\u5B8C\u6210",
    completedToggle: "\u5DF2\u5B8C\u6210 {n}",
    empty: "\u8FD9\u91CC\u8FD8\u6CA1\u6709\u5185\u5BB9",
    progress: "\u8FDB\u5EA6",
    flag_blocked: "\u5361\u4F4F",
    flag_clarify: "\u6B20\u6F84\u6E05",
    flag_stalled: "\u505C\u6EDE",
    flag_submittable: "\u53EF\u63D0\u4EA4",
    flag_acceptable: "\u5F85\u9A8C\u6536",
    start: "\u5F00\u59CB",
    submit: "\u63D0\u4EA4\u9A8C\u6536",
    confirm: "\u786E\u8BA4\u5B8C\u6210",
    rework: "\u6253\u56DE",
    freeze: "\u51BB\u7ED3",
    delete: "\u5220\u9664",
    reasonTitle: "\u9700\u8981\u586B\u5199\u539F\u56E0",
    reasonPlaceholder: "\u4E3A\u4EC0\u4E48\uFF1F\uFF08\u4E00\u53E5\u8BDD\uFF09",
    cancel: "\u53D6\u6D88",
    ok: "\u786E\u5B9A",
    moveRejectedTitle: "\u65E0\u6CD5\u79FB\u52A8",
    confirmCompleteTitle: "\u901A\u8FC7\u9A8C\u6536",
    confirmCompleteBody: "\u901A\u8FC7\u540E\uFF0C\u8FD9\u6761\u9700\u6C42\u4F1A\u6807\u4E3A\u5DF2\u5B8C\u6210\u3002",
    abandonTitle: "\u653E\u5F03\u672A\u5B8C\u6210\u7684 issue",
    abandonBody: "\u8FD8\u6709 {n} \u6761 issue \u672A\u5B8C\u6210\u3002\u53D6\u6D88\u9700\u8981\u586B\u5199\u539F\u56E0\uFF0C\u968F\u540E\u8BE5\u9700\u6C42\u5C06\u88AB\u5B8C\u6210\u3002",
    deleteTitle: "\u5220\u9664\u9700\u6C42",
    deleteBody: "\u628A\u300C{title}\u300D\u53CA\u5176 {n} \u6761 issue \u79FB\u5165\u56DE\u6536\u7AD9\uFF1F\u53EF\u4ECE .local/trash \u6062\u590D\u3002",
    detail: "\u9700\u6C42",
    next: "\u4E0B\u4E00\u6B65",
    q_who: "\u4F7F\u7528\u5BF9\u8C61",
    q_success: "\u5176\u4ED6\u5B8C\u6210\u6761\u4EF6",
    q_out: "\u660E\u786E\u4E0D\u505A",
    activity: "\u6D3B\u52A8",
    noActivity: "\u8FD8\u6CA1\u6709\u6D3B\u52A8",
    updates: "\u52A8\u6001",
    updatePlaceholder: "\u8BB0\u5F55\u4E00\u6761\u8FDB\u5C55\u2026",
    addUpdate: "\u53D1\u5E03\u8FDB\u5C55",
    issues: "\u4EFB\u52A1",
    addIssue: "\u52A0\u4E00\u6761\u4EFB\u52A1\u2026",
    issueLocked: "\u53EA\u6709\u8FDB\u884C\u4E2D\u624D\u80FD\u65B0\u589E\u4EFB\u52A1",
    issueTitle: "\u6807\u9898",
    acceptance: "\u9A8C\u6536",
    evidence: "\u8BC1\u636E",
    editIssue: "\u7F16\u8F91\u4EFB\u52A1",
    save: "\u4FDD\u5B58",
    description: "\u63CF\u8FF0",
    refs: "\u5173\u8054",
    created: "\u521B\u5EFA\u4E8E",
    updated: "\u66F4\u65B0\u4E8E",
    issueDetail: "\u4EFB\u52A1\u8BE6\u60C5",
    noRefs: "\u6682\u65E0\u5173\u8054",
    addRef: "\u6DFB\u52A0",
    addRefPlaceholder: "\u5982 src/core/store.js \u6216 openwiki/data/store.md",
    removeRef: "\u79FB\u9664\u5173\u8054",
    st_todo: "\u5F85\u529E",
    st_doing: "\u8FDB\u884C\u4E2D",
    st_blocked: "\u963B\u585E",
    st_in_review: "\u5F85\u9A8C\u6536",
    st_done: "\u5B8C\u6210",
    st_cancelled: "\u53D6\u6D88",
    blockedReason: "\u963B\u585E\u539F\u56E0",
    today: "\u4ECA\u65E5\u5EFA\u8BAE",
    current: "\u5F53\u524D\u5728\u505A",
    openIssue: "\u6253\u5F00",
    sug_submittable: "\u53EF\u4EE5\u63D0\u4EA4\u9A8C\u6536\u4E86",
    sug_blocked: "\u6709\u4EFB\u52A1\u88AB\u5361\u4F4F",
    sug_currentDoing: "\u7EE7\u7EED\u5F53\u524D\u4EFB\u52A1",
    sug_needsClarification: "\u8FD8\u5DEE\u4E00\u70B9\u6F84\u6E05",
    sug_stalled: "\u6709\u4E00\u9635\u5B50\u6CA1\u52A8\u4E86",
    errGeneric: "\u8FD9\u9879\u64CD\u4F5C\u6CA1\u6709\u5B8C\u6210\uFF0C\u8BF7\u91CD\u8BD5\u3002",
    noSession: "\u5C1A\u672A\u9009\u62E9\u4F1A\u8BDD",
    undo: "\u64A4\u9500",
    trashed: "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9",
    dismiss: "\u5173\u95ED",
    restored: "\u5DF2\u6062\u590D",
    markDone: "\u5B8C\u6210",
    block: "\u963B\u585E",
    unblock: "\u7EE7\u7EED",
    reopen: "\u8FD4\u5DE5",
    expand: "\u5C55\u5F00",
    collapse: "\u6536\u8D77",
    bind: "\u4F1A\u8BDD \u2192 \u9700\u6C42",
    unbound: "\u672A\u7ED1\u5B9A",
    bindWorkspace: "\u4F1A\u8BDD \u2192 \u672C\u5DE5\u4F5C\u533A",
    commit: "\u63D0\u4EA4 .project",
    uncommitted: "{n} \u9879\u672A\u63D0\u4EA4",
    committed: "\u5DF2\u63D0\u4EA4",
    gitUnavailable: "git \u4E0D\u53EF\u7528",
    viewBoard: "\u770B\u677F",
    viewWiki: "Wiki",
    viewSync: "\u5EFA\u8BAE",
    viewArch: "\u67B6\u6784",
    wikiTitle: "\u9879\u76EE Wiki",
    wikiEmpty: "\u8FD8\u6CA1\u6709 Wiki\uFF0C\u70B9\u51FB\u751F\u6210\u3002",
    wikiPages: "\u9875\u9762",
    wikiLastUpdate: "\u6700\u8FD1\u66F4\u65B0",
    wikiDateUnknown: "\u65E5\u671F\u672A\u77E5",
    mermaidNote: "Mermaid \u56FE\uFF08\u6E90\u7801\uFF09",
    wikiBack: "\u8FD4\u56DE\u9875\u9762\u5217\u8868",
    copy: "\u590D\u5236",
    copied: "\u5DF2\u590D\u5236",
    wikiEvidence: "\u6765\u6E90\u8BC1\u636E",
    wikiNoEvidence: "\u6B64\u9875\u6682\u65E0\u6765\u6E90\u8BB0\u5F55\u3002",
    wikiUnavailable: "\u6765\u6E90\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\uFF0C\u8BF7\u68C0\u67E5\u6765\u6E90\u662F\u5426\u53EF\u7528\u540E\u91CD\u8BD5\u3002",
    archTitle: "\u9879\u76EE\u67B6\u6784\u56FE",
    archGenerate: "\u751F\u6210\u67B6\u6784\u56FE",
    archRegenerate: "\u91CD\u65B0\u751F\u6210",
    archEmpty: "\u8FD8\u6CA1\u6709\u67B6\u6784\u56FE\u3002\u70B9\u51FB\u751F\u6210\uFF0C\u5C06\u57FA\u4E8E\u9879\u76EE\u6E90\u7801\u81EA\u52A8\u7ED8\u5236\u3002",
    archAuthoring: "\u6B63\u5728\u9605\u8BFB\u6E90\u7801\u5E76\u7ED8\u5236\u67B6\u6784\u56FE\u2026",
    archRendering: "\u6B63\u5728\u751F\u6210\u56FE\u2026",
    archRepairing: "\u6B63\u5728\u4F18\u5316\u5E03\u5C40\u2026",
    archDone: "\u67B6\u6784\u56FE\u5DF2\u5C31\u7EEA\u3002",
    archHint: "\u57FA\u4E8E\u9879\u76EE\u6E90\u7801\u81EA\u52A8\u751F\u6210",
    syncTitle: "\u8FDB\u5C55\u5EFA\u8BAE",
    syncRun: "\u6838\u5BF9\u8FDB\u5C55",
    syncRunning: "\u6B63\u5728\u67E5\u9605\u8BB0\u5F55\u2026",
    syncDone: "\u5DF2\u6838\u5BF9\u8FDB\u5C55\u3002",
    syncNone: "\u5DF2\u6838\u5BF9\u8FDB\u5C55\uFF0C\u6682\u65F6\u6CA1\u6709\u5EFA\u8BAE\u3002",
    syncEmpty: "\u6682\u65E0\u5F85\u5904\u7406\u5EFA\u8BAE\u3002\u53EF\u4EE5\u6838\u5BF9\u9879\u76EE\u8FDB\u5C55\uFF0C\u770B\u770B\u662F\u5426\u6709\u66F4\u65B0\u3002",
    syncDismiss: "\u5FFD\u7565",
    syncEvidence: "\u53C2\u8003\u8D44\u6599",
    syncSaved: "\u65B0\u589E {n} \u6761\u5EFA\u8BAE",
    syncPending: "{n} \u6761\u5F85\u5904\u7406",
    syncAcceptRate: "\u91C7\u7528\u7387 {rate}%\uFF08{accepted}/{total}\uFF09",
    kind_advance: "\u72B6\u6001\u63A8\u8FDB",
    kind_review: "\u72B6\u6001\u590D\u6838",
    kind_capture: "\u6355\u83B7\u65B0\u5DE5\u4F5C",
    kind_clarify: "\u6B20\u6F84\u6E05",
    kind_stalled: "\u505C\u6EDE",
    kind_wiki_drift: "Wiki \u6F02\u79FB",
    wikiTryAgain: "Wiki \u751F\u6210\u672A\u5B8C\u6210\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002",
    wikiStagingFailed: "\u65E0\u6CD5\u51C6\u5907\u4E34\u65F6\u5DE5\u4F5C\u526F\u672C\uFF0C\u8BF7\u68C0\u67E5\u9879\u76EE\u72B6\u6001\u548C\u6587\u4EF6\u6743\u9650\u540E\u91CD\u8BD5\u3002\u539F Wiki \u672A\u6539\u52A8\u3002",
    wikiSourceUnsupported: "\u6B64\u9879\u76EE\u5305\u542B\u6682\u4E0D\u652F\u6301\u7684 Git \u5DE5\u4F5C\u6811\u3001\u5B50\u6A21\u5757\u3001\u7B26\u53F7\u94FE\u63A5\u6216\u7279\u6B8A\u7D22\u5F15\uFF0C\u539F Wiki \u672A\u6539\u52A8\u3002",
    wikiPublishConflict: "\u751F\u6210\u671F\u95F4\u9879\u76EE\u6216 Wiki \u6709\u53D8\u5316\uFF0C\u65B0\u5185\u5BB9\u6CA1\u6709\u8986\u76D6\u539F Wiki\u3002\u8BF7\u91CD\u65B0\u66F4\u65B0\u3002",
    wikiPublishFailed: "\u65B0 Wiki \u672A\u80FD\u6B63\u5E38\u53D1\u5E03\uFF0C\u8BF7\u68C0\u67E5\u9879\u76EE\u76EE\u5F55\u540E\u91CD\u8BD5\u3002",
    wikiPublishRecovery: "\u65B0 Wiki \u672A\u80FD\u53D1\u5E03\uFF0C\u539F\u8D44\u6599\u4FDD\u5B58\u5728\u4EE5\u4E0B\u4F4D\u7F6E\uFF0C\u8BF7\u5148\u68C0\u67E5\u5E76\u6062\u590D\uFF1A",
    wikiPublishedStatusFailed: "\u65B0 Wiki \u5DF2\u53D1\u5E03\uFF0C\u4F46\u66F4\u65B0\u72B6\u6001\u672A\u80FD\u4FDD\u5B58\uFF1B\u8BF7\u68C0\u67E5\u9879\u76EE\u76EE\u5F55\u4E2D\u7684 Wiki \u540E\u518D\u91CD\u8BD5\u3002",
    wikiPublishing: "Wiki \u5DF2\u751F\u6210\uFF0C\u6B63\u5728\u53D1\u5E03\uFF0C\u6B64\u65F6\u65E0\u6CD5\u505C\u6B62\u3002",
    wikiRebuildNotice: "\u66F4\u65B0\u4F1A\u91CD\u65B0\u751F\u6210\uFF1BGit \u5FFD\u7565\u6587\u4EF6\u4E0D\u53C2\u4E0E\uFF0C\u539F\u8D44\u6599\u4FDD\u5B58\u5728\u9879\u76EE\u672C\u5730\u5907\u4EFD\u4E2D\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u5408\u5E76\u3002",
    wikiShowingPrevious: "\u6B63\u5728\u67E5\u770B\u672C\u6B21\u66F4\u65B0\u524D\u4FDD\u5B58\u7684 Wiki\u3002",
    wikiPreviousUnavailable: "\u4E0A\u6B21\u66F4\u65B0\u6CA1\u6709\u4FDD\u5B58\u6B64\u524D\u7248\u672C\uFF0C\u5F53\u524D\u9875\u9762\u53EF\u80FD\u5DF2\u88AB\u6539\u5199\u3002",
    wikiSnapshotFailed: "\u65E0\u6CD5\u5B89\u5168\u4FDD\u5B58 Wiki \u526F\u672C\uFF0C\u66F4\u65B0\u6CA1\u6709\u542F\u52A8\uFF1B\u8BF7\u68C0\u67E5\u6587\u4EF6\u6743\u9650\u3001\u5C5E\u6027\u3001\u5927\u5C0F\u53CA\u7CFB\u7EDF\u652F\u6301\u540E\u91CD\u8BD5\u3002",
    wikiSnapshotUnreadable: "\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u5DF2\u4FDD\u5B58\u7684 Wiki \u7248\u672C\uFF0C\u66F4\u65B0\u6CA1\u6709\u542F\u52A8\u3002",
    wikiSavedViewUnreadable: "\u5DF2\u4FDD\u5B58\u7684 Wiki \u7248\u672C\u7F3A\u5931\u6216\u635F\u574F\uFF0C\u6682\u65F6\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u3002",
    wikiExternalChangeView: "\u5F53\u524D Wiki \u72B6\u6001\u53D1\u751F\u53D8\u5316\u6216\u6682\u65F6\u65E0\u6CD5\u6838\u9A8C\uFF1B\u6B63\u5728\u663E\u793A\u8F83\u65E9\u7684\u4FDD\u5B58\u7248\u672C\u3002",
    wikiNoSavedExternal: "\u5F53\u524D Wiki \u72B6\u6001\u53D1\u751F\u53D8\u5316\u6216\u6682\u65F6\u65E0\u6CD5\u6838\u9A8C\uFF0C\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u8F83\u65E9\u4FDD\u5B58\u7248\u672C\u3002",
    wikiExternalChangeBlocked: "\u5F53\u524D Wiki \u72B6\u6001\u53D1\u751F\u53D8\u5316\u6216\u6682\u65F6\u65E0\u6CD5\u6838\u9A8C\uFF1B\u8BF7\u5148\u68C0\u67E5\u66F4\u65B0\u72B6\u6001\uFF0C\u518D\u542F\u52A8\u65B0\u7684\u66F4\u65B0\u3002",
    wikiRootNotTopLevel: "\u8BF7\u5C06 Git \u4ED3\u5E93\u7684\u9876\u5C42\u6587\u4EF6\u5939\u4F5C\u4E3A\u9879\u76EE\u6253\u5F00\u540E\uFF0C\u518D\u751F\u6210 Wiki\u3002",
    wikiNeedsGit: "\u751F\u6210 Wiki \u9700\u8981 Git \u4ED3\u5E93\u3002\u8BF7\u5148\u5728\u5F53\u524D\u9879\u76EE\u521D\u59CB\u5316 Git\uFF0C\u65E0\u9700\u63D0\u4EA4\u3002",
    wikiGitMissing: "\u627E\u4E0D\u5230 Git\u3002\u8BF7\u5B89\u88C5 Git \u6216\u68C0\u67E5\u5176\u914D\u7F6E\u540E\u91CD\u8BD5\u3002",
    wikiRootUnavailable: "\u65E0\u6CD5\u8BFB\u53D6\u9879\u76EE\u7684 Git \u5DE5\u4F5C\u76EE\u5F55\u3002\u8BF7\u786E\u8BA4 Git \u53EF\u7528\uFF0C\u5E76\u6253\u5F00\u5305\u542B\u9879\u76EE\u6587\u4EF6\u7684\u4ED3\u5E93\u9876\u5C42\u6587\u4EF6\u5939\u3002",
    wikiStateUnreadable: "\u65E0\u6CD5\u5B89\u5168\u8BFB\u53D6\u73B0\u6709 Wiki \u6216\u672A\u5B8C\u6210\u7684\u66F4\u65B0\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u540E\u91CD\u8BD5\u3002",
    wikiMetadataUnsafe: "Wiki \u4E2D\u6709\u7CFB\u7EDF\u4F34\u968F\u6587\u4EF6\uFF0C\u5F53\u524D\u751F\u6210\u5668\u53EF\u80FD\u8BEF\u5904\u7406\u3002\u4E3A\u4FDD\u62A4\u6587\u4EF6\uFF0C\u6682\u65F6\u4E0D\u80FD\u66F4\u65B0\uFF0C\u8BF7\u68C0\u67E5\u540E\u91CD\u8BD5\u3002",
    wikiCheckpointUnsafe: "\u4E0A\u6B21 Wiki \u66F4\u65B0\u8BB0\u5F55\u628A\u7CFB\u7EDF\u4F34\u968F\u6587\u4EF6\u5F53\u6210\u4E86\u9875\u9762\u3002\u4E3A\u4FDD\u62A4\u8D44\u6599\uFF0C\u6682\u65F6\u4E0D\u80FD\u7EE7\u7EED\uFF0C\u8BF7\u68C0\u67E5\u66F4\u65B0\u8BB0\u5F55\u3002",
    archTryAgain: "\u67B6\u6784\u56FE\u6682\u65F6\u65E0\u6CD5\u751F\u6210\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002",
    archSourceRequired: "\u8FD9\u6B21\u751F\u6210\u6CA1\u6709\u627E\u5230\u53EF\u5F15\u7528\u7684\u9879\u76EE\u6E90\u7801\u3002\u8BF7\u786E\u8BA4\u9879\u76EE\u4E2D\u5DF2\u6709\u53EF\u8BFB\u53D6\u7684\u6E90\u7801\uFF0C\u518D\u8BD5\u4E00\u6B21\u3002",
    archSourceInvalid: "\u67B6\u6784\u56FE\u5F15\u7528\u7684\u6587\u4EF6\u6216\u884C\u53F7\u65E0\u6CD5\u6838\u5BF9\u3002\u8BF7\u68C0\u67E5\u9879\u76EE\u6E90\u7801\u540E\u91CD\u8BD5\u3002",
    generationNeedsSession: "\u8BF7\u6253\u5F00\u8FD9\u4E2A\u9879\u76EE\u4E2D\u7684\u4F1A\u8BDD\u540E\u91CD\u8BD5\u3002",
    generationStatusUnavailable: "\u6682\u65F6\u65E0\u6CD5\u786E\u8BA4\u5904\u7406\u8FDB\u5EA6\u3002\u91CD\u8BD5\u53EF\u91CD\u65B0\u786E\u8BA4\u3002",
    generationStopFailed: "\u505C\u6B62\u8BF7\u6C42\u672A\u5B8C\u6210\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002",
    syncRunFailed: "\u8FDB\u5C55\u6838\u5BF9\u672A\u5B8C\u6210\uFF0C\u53EF\u4EE5\u91CD\u8BD5\u3002",
    syncAdoptContent: "\u6279\u91CF\u91C7\u7528\u5185\u5BB9\u5EFA\u8BAE",
    syncLocateRequirement: "\u5728\u770B\u677F\u5B9A\u4F4D",
    syncLocateTask: "\u5728\u4EFB\u52A1\u680F\u5B9A\u4F4D",
    syncSourceConversation: "\u4EFB\u52A1\u4F1A\u8BDD",
    syncSourceDraft: "\u4F9D\u636E\u9879\u76EE\u5185\u5BB9\u8D77\u8349",
    syncSourceCommit: "\u4EE3\u7801\u63D0\u4EA4 {revision}",
    syncBatchResult: "\u5DF2\u91C7\u7528 {adopted} \u6761\uFF0C{failed} \u6761\u672A\u80FD\u91C7\u7528",
    kind_req_draft: "\u9700\u6C42\u8349\u7A3F",
    kind_field_draft: "\u4EFB\u52A1\u8349\u7A3F",
    kind_new_task: "\u65B0\u589E\u4EFB\u52A1",
    kind_task_suggestion: "\u4EFB\u52A1\u5EFA\u8BAE",
    wikiBusy: "\u53E6\u4E00\u4E2A\u9879\u76EE\u6B63\u5728\u751F\u6210 Wiki\uFF0C\u8BF7\u7B49\u5B83\u5B8C\u6210\u6216\u5148\u505C\u6B62\u3002",
    wikiGenerate: "\u751F\u6210 Wiki",
    wikiUpdate: "\u66F4\u65B0 Wiki",
    wikiStop: "\u505C\u6B62",
    wikiStopping: "\u6B63\u5728\u505C\u6B62\u2026",
    wikiStopped: "\u5DF2\u505C\u6B62\u751F\u6210\u3002",
    wikiGenerating: "\u6B63\u5728\u751F\u6210 Wiki\u2026\u53EF\u80FD\u9700\u8981\u51E0\u5206\u949F\u3002",
    wikiDone: "Wiki \u751F\u6210\u5B8C\u6210\u3002",
    wikiNoop: "Wiki \u5DF2\u662F\u6700\u65B0\uFF0C\u65E0\u9700\u66F4\u65B0\u3002",
    wikiProbeOk: "Wiki \u751F\u6210\u670D\u52A1\u53EF\u7528\uFF08{n} \u4E2A\u5DE5\u5177\uFF09\u3002",
    wikiProbeMissing: "Wiki \u751F\u6210\u670D\u52A1\u4E0D\u53EF\u7528\u3002",
    demoTitle: "\u9636\u6BB51\u539F\u578B\u6F14\u793A\uFF08\u4E34\u65F6\u5165\u53E3\uFF09",
    demoPrepare: "\u51C6\u5907\u6F14\u793A\u6570\u636E",
    demoView: "\u67E5\u770B",
    demoStart: "\u5F00\u59CB\u5904\u7406",
    demoHint: "\u67E5\u770B\u4E0D\u53D1\u9001\u8BF7\u6C42\uFF1B\u5F00\u59CB\u53EA\u63D0\u4EA4\u4E00\u6B21\u3002",
    demoOpened: "\u5DF2\u6253\u5F00\u4EFB\u52A1\u4F1A\u8BDD\u3002",
    demoTabFallback: "\u4F1A\u8BDD\u5DF2\u6253\u5F00\uFF1B\u8BF7\u5728\u53F3\u680F\u6253\u5F00\u300C\u9879\u76EE\u5DE5\u4F5C\u53F0\u300D\u67E5\u770B\u4EFB\u52A1\u5361\u3002",
    demoStarted: "\u5DF2\u63D0\u4EA4\u4E00\u6B21\u5904\u7406\u8BF7\u6C42\u3002",
    demoAlready: "\u5DF2\u6709\u6267\u884C\u4E2D\u7684\u8BF7\u6C42\uFF0C\u8FDB\u5165\u4F1A\u8BDD\u67E5\u770B\u8FDB\u5EA6\u3002",
    demoBusy: "\u4F1A\u8BDD\u6B63\u5728\u5904\u7406\u5176\u4ED6\u8F93\u5165\uFF0C\u672A\u63D0\u4EA4\u65B0\u8BF7\u6C42\u3002",
    demoUncertain: "\u63D0\u4EA4\u7ED3\u679C\u4E0D\u660E\u786E\uFF0C\u5DF2\u4FDD\u7559\u6267\u884C\u9501\uFF1B\u8BF7\u91CD\u8BD5\u6838\u5B9E\u3002",
    demoNoLink: "\u672C\u4F1A\u8BDD\u672A\u5173\u8054\u6F14\u793A\u4EFB\u52A1\u3002",
    demoUnrecorded: "\u672C\u8F6E\u53EF\u80FD\u6709\u672A\u8BB0\u5F55\u7684\u8FDB\u5C55\u3002",
    demoNotePlaceholder: "\u8F93\u5165\u4EBA\u5DE5\u8FDB\u5C55\u2026",
    demoNote: "\u4EBA\u5DE5\u8BB0\u5F55",
    demoContinue: "\u7EE7\u7EED\u5904\u7406",
    demoStop: "\u505C\u6B62",
    demoRunState: "\u6267\u884C",
    demoCursor: "\u5DF2\u8BB0\u5F55\u5230\u4E8B\u4EF6",
    demoFailed: "\u6F14\u793A\u64CD\u4F5C\u5931\u8D25",
    demoResult: "\u5904\u7406\u7ED3\u679C",
    demoEvidence: "\u9A8C\u8BC1\u4F9D\u636E",
    demoAcceptance: "\u5B8C\u6210\u6807\u51C6",
    demoLimits: "\u5DF2\u77E5\u9650\u5236",
    demoNoResult: "\u5C1A\u65E0\u7ED3\u679C",
    demoConfirm: "\u4EFB\u52A1\u9A8C\u6536\u901A\u8FC7",
    submitTaskAcceptance: "\u63D0\u4EA4\u4EFB\u52A1\u9A8C\u6536",
    demoDrafts: "\u5F85\u91C7\u7528\u8349\u7A3F",
    demoAdopt: "\u91C7\u7528",
    demoDismiss: "\u653E\u5F03",
    demoDeliveryFailed: "\u6458\u8981\u751F\u6210\u5931\u8D25",
    demoManualSummary: "\u586B\u5199\u4EA4\u4ED8\u6458\u8981\u2026",
    demoSubmitAcceptance: "\u63D0\u4EA4\u9A8C\u6536",
    demoDeliverySummary: "\u4EA4\u4ED8\u6458\u8981",
    demoPendingAcceptance: "\u5F85\u9A8C\u6536",
    demoCancelImpact: "\u53D6\u6D88\u5BF9\u8303\u56F4\u7684\u5F71\u54CD"
  };
  var css = `
.pw-page{box-sizing:border-box;position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) clamp(16px,3vw,32px) 16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:var(--dsh-content-font-size,14px)}
.pw-page *{box-sizing:border-box}
.pw-page ::-webkit-scrollbar{width:10px;height:10px}
.pw-page ::-webkit-scrollbar-track{background:transparent}
.pw-page ::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid transparent;background-clip:content-box}
.pw-page ::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);background-clip:content-box}
.pw-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px}
.pw-title{margin:0;font-size:18px;font-weight:500}
.pw-ws-switch{position:relative;display:flex;align-items:center;min-width:0}
.pw-ws-button{display:inline-flex;align-items:center;gap:6px;max-width:min(52vw,560px);border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:18px;font-weight:500;padding:2px 4px;border-radius:6px;cursor:pointer}
.pw-ws-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-ws-button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-ws-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-ws-caret{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-ws-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:30;display:flex;flex-direction:column;gap:2px;min-width:240px;max-width:min(420px,80vw);max-height:320px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:4px;box-shadow:0 8px 24px rgba(0,0,0,.28)}
.pw-ws-item{display:flex;align-items:center;gap:8px;width:100%;border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;padding:7px 8px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere}
.pw-ws-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-ws-item.active{background:var(--dsw-alias-interactive-bg-active)}
.pw-ws-check{flex:none;width:14px;font-size:12px;color:var(--dsw-alias-brand-primary)}
.pw-workspace-list{display:flex;flex-direction:column;gap:8px;width:min(440px,92%);max-height:50vh;overflow:auto;margin:6px 0}
.pw-workspace-card{display:flex;flex-direction:column;align-items:flex-start;gap:3px;width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.pw-workspace-card:hover{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-workspace-card .pw-count{max-width:100%;overflow-wrap:anywhere}
.pw-spacer{flex:1}
.pw-button{min-height:30px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;transition:background .12s ease,border-color .12s ease}
.pw-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pw-button:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.pw-button:disabled{opacity:.5;cursor:not-allowed}
.pw-button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.pw-button.primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.pw-button.danger{color:var(--dsw-alias-state-error-primary)}
.pw-button:focus-visible,.pw-input:focus-visible,.pw-card:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-input{min-height:32px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;width:100%}
.pw-banner{padding:8px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);margin-bottom:10px;font-size:13px;display:flex;gap:8px;align-items:center}
.pw-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.pw-banner.pw-warn{border-color:var(--dsw-alias-state-warn-primary)}
.pw-diaglist{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.pw-diaglist code{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-diagwrap{display:flex;flex-direction:column;gap:4px;min-width:0}
.pw-diagwrap summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.pw-board{flex:1;display:grid;grid-auto-flow:column;grid-auto-columns:minmax(160px,1fr);gap:12px;min-height:0;overflow:auto;padding-bottom:4px}
.pw-col{display:flex;flex-direction:column;min-height:0;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px}
.pw-col.pw-drop-target{border-color:var(--dsw-alias-brand-primary)}
.pw-col.dragover{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-colhead{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:10px}
.pw-dot{width:8px;height:8px;border-radius:50%;flex:none}
.pw-count{font-size:12px;color:var(--dsw-alias-label-tertiary);font-weight:400}
.pw-cards{display:flex;flex-direction:column;gap:8px;overflow:auto;min-height:0;padding-right:2px}
.pw-card{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);padding:10px;cursor:grab;min-height:44px;user-select:none;transition:border-color .12s ease,transform .12s ease,box-shadow .12s ease}
.pw-preview{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.pw-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 8px}
.pw-subpage-head h2{overflow-wrap:anywhere}
.pw-disclosure{border-top:1px solid var(--dsw-alias-border-l3);padding:8px 0}
.pw-disclosure summary{cursor:pointer;color:var(--dsw-alias-label-secondary);padding:4px 0}
.pw-disclosure summary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-result{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;padding:10px;margin:6px 0;min-width:0}
.pw-task-pane{overflow:auto;display:block;padding:10px 12px 16px}
.pw-result ul{padding-inline-start:20px}
.pw-card:hover{border-color:var(--dsw-alias-border-l1);transform:translateY(-1px)}
.pw-card:active{cursor:grabbing}
.pw-card.selected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary)}
.pw-cardtitle{font-size:14px;line-height:20px;margin:0 0 7px;overflow-wrap:anywhere;font-weight:500}
.pw-cardmeta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.pw-flag{padding:1px 7px;border-radius:5px;font-size:11px;line-height:16px;flex:none;background:var(--dsw-alias-bg-layer-2)}
.pw-flag.blocked{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.pw-flag.clarify,.pw-flag.stalled{color:var(--dsw-alias-state-warn-label)}
.pw-flag.submittable,.pw-flag.acceptable{color:var(--dsw-alias-state-success-primary)}
.pw-next{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:5px;overflow-wrap:anywhere}
.pw-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;flex:1}
.pw-bar>span{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .2s ease}
.pw-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:12px 4px;text-align:center;border:1px dashed var(--dsw-alias-border-l3);border-radius:8px}
.pw-lower{display:flex;gap:12px;margin-top:12px;min-height:0;max-height:42%}
.pw-detail,.pw-issues{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px}
.pw-field{margin-bottom:10px}
.pw-label{display:block;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:4px}
.pw-issue{display:flex;align-items:center;gap:8px;padding:0 8px 0 0;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-base);margin-bottom:6px}
.pw-istatus{font-size:11px;line-height:16px;padding:1px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);flex:none}
.pw-istatus.st-doing{color:var(--dsw-alias-brand-primary)}
.pw-istatus.st-done{color:var(--dsw-alias-state-success-primary)}
.pw-istatus.st-blocked{color:var(--dsw-alias-state-error-primary)}
.pw-istatus.st-cancelled{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.pw-select{min-height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
.pw-act{font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.pw-modal-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-base);opacity:.55;z-index:40}
.pw-modal{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:41;width:min(420px,90%);max-height:90%;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px;display:flex;flex-direction:column;gap:10px}
.pw-modal h3{margin:0;font-size:15px}
.pw-modal p{margin:0;font-size:13px;color:var(--dsw-alias-label-secondary)}
.pw-modal-actions{display:flex;justify-content:flex-end;gap:8px}
.pw-modal.wide{width:min(620px,92vw);max-height:86vh}
.pw-modal-body{overflow:auto;display:flex;flex-direction:column;gap:10px;min-height:0;padding-right:2px}
.pw-textarea{width:100%;min-height:72px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;resize:vertical;line-height:1.5}
.pw-textarea:focus{border-color:var(--dsw-alias-brand-primary);outline:none}
.pw-issue-title{display:flex;align-items:center;gap:8px;justify-content:space-between;flex:1;min-width:0;min-height:44px;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;text-align:left}
.pw-issue-title:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-brand-primary)}
.pw-issue-title:focus-visible,.pw-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-issue .pw-select{flex:none;max-width:42%}
.pw-refchip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);margin:0 4px 4px 0;font-family:var(--dsh-font-family-mono,monospace)}
.pw-reflink{border:none;cursor:pointer;color:var(--dsw-alias-brand-primary)}
.pw-reflink:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-refwrap{display:inline-flex;align-items:center;gap:2px;margin:0 6px 4px 0}
.pw-refdel{border:none;background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px;padding:2px;border-radius:4px}
.pw-refdel:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-meta-row{display:flex;gap:16px;font-size:11px;color:var(--dsw-alias-label-tertiary);flex-wrap:wrap}
.pw-detail-status{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pw-updates{margin-top:12px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:10px}
.pw-update-list{display:flex;flex-direction:column;gap:6px;margin:6px 0 10px;max-height:220px;overflow:auto}
.pw-update{display:flex;gap:8px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-base)}
.pw-update-ts{flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary);font-family:var(--dsh-font-family-mono,monospace);padding-top:1px}
.pw-update-body{font-size:13px;line-height:1.5;overflow-wrap:anywhere}
.pw-update-add{display:flex;gap:6px}
.pw-update-add .pw-input{flex:1}
.pw-init{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center}
.pw-sync{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
.pw-sync-list{display:flex;flex-direction:column;gap:10px}
.pw-proposal{border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:8px}
.pw-proposal-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pw-proposal-reason{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.pw-proposal-evidence{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pw-moveerr{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-primary);padding:4px 0}
.pw-evidence{margin-top:16px;border-top:1px solid var(--dsw-alias-border-l3);padding-top:10px}
.pw-claim{border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);padding:8px 10px;margin-top:8px}
.pw-claim-stmt{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.pw-claim-ev{margin-top:6px;display:flex;flex-wrap:wrap;gap:4px}
.pw-arch{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.pw-arch-frame{flex:1;min-height:0;width:100%;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base)}
.pw-subpage-stack{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px}
.pw-subpage-stack>.pw-subpage{flex:none}
.pw-subpage{min-height:0;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:20px}
.pw-breadcrumb{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;overflow:auto;white-space:nowrap;flex:none}
.pw-crumb{border:none;background:none;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;padding:2px 4px;border-radius:4px}
.pw-crumb:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-crumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-crumb-sep{color:var(--dsw-alias-label-tertiary)}
.pw-crumb-current{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis}
.pw-subpage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}
.pw-subpage-head h2{margin:0 0 4px;font-size:20px;line-height:28px;overflow-wrap:anywhere}
.pw-reading{max-width:860px;line-height:1.6}
.pw-reading-block{margin:0 0 12px}
.pw-reading-label{font-size:14px;font-weight:600;margin:0 0 4px}
.pw-reading-list{padding-inline-start:22px;margin:4px 0 8px;overflow-wrap:anywhere}
.pw-reading-list li{margin:3px 0;white-space:pre-wrap}
.pw-read-card{padding:clamp(14px,2vw,24px)}
.pw-read-card .pw-subpage-head{flex-direction:row;flex-wrap:wrap;gap:10px 20px;margin-bottom:18px}
.pw-read-card .pw-subpage-head>.pw-actions{max-width:100%}
.pw-read-card .pw-read-title{display:flex;align-items:center;flex:1 1 280px;flex-wrap:wrap;gap:6px 10px;min-width:0}
.pw-read-card .pw-read-title h2{max-width:100%;margin:0;font-size:1.6em;line-height:1.25;font-weight:650}
.pw-read-card .pw-read-status{
  --pw-status-accent:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 8px;
  border:1px solid var(--dsw-alias-border-l3);border-radius:999px;
  background:var(--dsw-alias-bg-layer-2);
  background:color-mix(in srgb,var(--pw-status-accent) 9%,var(--dsw-alias-bg-layer-1));
  color:var(--dsw-alias-label-primary);font-size:.85em;font-weight:550;line-height:1.5;overflow-wrap:anywhere
}
.pw-read-card .pw-read-status::before{content:'';flex:none;width:6px;height:6px;border-radius:50%;background:var(--pw-status-accent)}
.pw-read-card .pw-read-status:is([data-status="in_progress"],[data-status="doing"]){--pw-status-accent:var(--dsw-alias-brand-primary)}
.pw-read-card .pw-read-status:is([data-status="completed"],[data-status="done"]){--pw-status-accent:var(--dsw-alias-state-success-primary)}
.pw-read-card .pw-read-status[data-status="blocked"]{--pw-status-accent:var(--dsw-alias-state-warn-label)}
.pw-read-card > .pw-reading{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;max-width:760px;line-height:1.65}
.pw-read-card .pw-reading-block{margin:0}
.pw-read-card .pw-reading-label{margin:0 0 4px;color:var(--dsw-alias-label-secondary);font-size:.93em}
.pw-read-card .pw-reading-block > :is(.pw-text,.pw-reading-list){margin-block:0}
.pw-read-card .pw-reading-block > :is(.pw-text,.pw-reading-list) + :is(.pw-text,.pw-reading-list){margin-block-start:6px}
.pw-read-card .pw-reading-block > div + div{margin-block-start:8px}
.pw-read-card .pw-reading-block > div > strong{color:var(--dsw-alias-label-secondary);font-size:.9em}
.pw-read-card .pw-reading-lead > :is(p,ol,ul):first-child,
.pw-read-card .pw-reading-lead > h3 + :is(p,ol,ul){font-size:1.12em}
.pw-read-card :is(.pw-reading-divider,.pw-reading-delivery,.pw-reading-footer){border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:12px}
.pw-read-card .pw-reading-divider:first-child{border:0;padding:0}
.pw-read-card .pw-reading-criteria{
  padding:10px 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;
  background:var(--dsw-alias-bg-layer-2);
  background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,var(--dsw-alias-bg-layer-1))
}
.pw-read-card .pw-reading-reason{
  padding:10px 14px;border-inline-start:3px solid var(--dsw-alias-border-l2);border-radius:6px;
  background:var(--dsw-alias-bg-layer-2)
}
.pw-read-card .pw-reading-warning{
  border-inline-start-color:var(--dsw-alias-state-warn-label);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 10%,var(--dsw-alias-bg-layer-1))
}
.pw-read-card :is(.pw-reading-result,.pw-reading-delivery){display:grid;grid-template-columns:minmax(0,1fr);gap:10px}
.pw-read-card > .pw-reading > .pw-reading-result{border-block:1px solid var(--dsw-alias-border-l3);padding-block:12px}
.pw-read-card > .pw-reading > .pw-reading-result:first-child{border-block-start:0;padding-block-start:0}
.pw-read-card .pw-reading-verification strong{font-size:.93em;color:var(--dsw-alias-label-secondary)}
.pw-read-card .pw-reading-verification .pw-text{margin:2px 0}
.pw-read-card .pw-reading > .pw-note{margin:0;color:var(--dsw-alias-label-secondary)}
.pw-read-card .pw-reading-result > .pw-note{color:var(--dsw-alias-state-warn-label)}
.pw-read-card > .pw-reading > .pw-disclosure{border:0;padding:0}
.pw-read-card > .pw-reading > .pw-disclosure > .pw-reading-block + .pw-reading-block{margin-block-start:10px}
.pw-read-card .pw-reading-footer{color:var(--dsw-alias-label-secondary);font-size:.9em;font-variant-numeric:tabular-nums}
.pw-detail-more{border:0;padding:0}
.pw-detail-more summary{margin-bottom:4px}
.pw-card-shell{min-width:0}
.pw-card-retry{margin-top:4px}
.pw-actions{display:flex;gap:8px;flex-wrap:wrap}
.pw-quiet{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.pw-quiet:focus-visible,.pw-task-menu summary:focus-visible,.pw-progress-item summary:focus-visible,.pw-choice:focus-within{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-task-fields .pw-field,.pw-task-picker .pw-field,.pw-progress-form .pw-field{display:block;margin:0 0 10px}
.pw-task-fields .pw-textarea[rows="1"]{min-height:32px;padding-block:5px}
.pw-task-toolbar,.pw-task-tools{display:flex;align-items:center;gap:6px;min-width:0}
.pw-task-toolbar{justify-content:space-between;flex-wrap:wrap;margin:0 0 10px}
.pw-task-tools{justify-content:flex-end;flex-wrap:wrap}
.pw-task-toolbar .pw-quiet{padding-inline:8px}
.pw-task-menu{position:relative}
.pw-task-menu summary{list-style:none;cursor:pointer;display:grid;place-items:center;border-radius:6px;min-width:34px;min-height:32px;font-size:21px;line-height:1}
.pw-task-menu summary::-webkit-details-marker,.pw-progress-item summary::-webkit-details-marker{display:none}
.pw-task-menu summary:hover,.pw-task-menu[open] summary{background:var(--dsw-alias-interactive-bg-hover)}
.pw-task-menu-items{position:absolute;z-index:4;inset-inline-end:0;top:calc(100% + 4px);width:max-content;max-width:210px;min-width:126px;display:grid;gap:2px;padding:5px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 8px 20px rgba(0,0,0,.22)}
.pw-task-menu-items .pw-button{text-align:start}
.pw-sidebar-notice{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;margin:0 0 9px;color:var(--dsw-alias-label-secondary);font-size:.9em}
.pw-sidebar-detail,.pw-task-picker{padding:14px 16px;overflow:visible}
.pw-sidebar-detail{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;line-height:1.55}
.pw-sidebar-heading{display:grid;gap:6px;padding-block-end:12px;border-block-end:1px solid var(--dsw-alias-border-l3)}
.pw-sidebar-title{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:8px}
.pw-sidebar-meta,.pw-task-picker-head,.pw-progress-head{display:flex;gap:4px 10px;align-items:center;flex-wrap:wrap;min-width:0}
.pw-sidebar-title h2,.pw-task-picker-head h2{font-size:1.38em;line-height:1.35;margin:0;overflow-wrap:anywhere;min-width:0}
.pw-sidebar-title h2{font-weight:650}
.pw-sidebar-title .pw-quiet,.pw-task-toolbar .pw-button{font-size:.92em}
.pw-task-picker-head .pw-quiet,.pw-progress-head .pw-quiet{margin-inline-start:auto}
.pw-parent-link{font-size:.9em;text-align:start;overflow-wrap:anywhere;max-width:100%;padding-inline:2px}
.pw-parent-link:hover{text-decoration:underline}
.pw-sidebar-detail :is(.pw-note,.pw-error){margin:0;overflow-wrap:anywhere}
.pw-sidebar-detail .pw-note{color:var(--dsw-alias-label-secondary);font-size:.89em}
.pw-sidebar-detail>.pw-reading{gap:14px;line-height:1.6}
.pw-sidebar-detail .pw-reading-label{margin-block-end:3px;font-size:.91em}
.pw-sidebar-detail .pw-reading-lead > h3 + :is(p,ol,ul){font-size:1em}
.pw-sidebar-detail .pw-sidebar-empty-field .pw-text{color:var(--dsw-alias-label-secondary);font-size:.93em}
.pw-sidebar-detail .pw-reading-divider{padding-block-start:12px}
.pw-sidebar-detail>.pw-reading>.pw-sidebar-review{
  gap:12px;padding:12px;border:1px solid var(--dsw-alias-border-l3);
  border-radius:8px;background:var(--dsw-alias-bg-base);min-width:0
}
.pw-sidebar-review .pw-reading-criteria{padding:8px 10px;border:0;border-inline-start:2px solid var(--dsw-alias-brand-primary);border-radius:4px}
.pw-sidebar-review .pw-reading-verification .pw-text{margin-block:3px 0}
.pw-sidebar-detail .pw-sidebar-review>.pw-evidence-note{color:var(--dsw-alias-label-secondary)}
.pw-sidebar-review .pw-acceptance-assist,.pw-review-actions{border-block-start:1px solid var(--dsw-alias-border-l3);padding-block-start:10px}
.pw-sidebar-review .pw-acceptance-assist{display:grid;grid-template-columns:minmax(0,1fr);gap:7px}
.pw-sidebar-review .pw-acceptance-assist>.pw-reading-label{margin:0}
.pw-assist-actions{display:flex;flex-wrap:wrap;gap:6px}
.pw-assist-actions>.pw-button{flex:1 1 auto;max-width:100%;padding-inline:9px}
.pw-sidebar-review .pw-assist-disclosure{padding:0;border:0}
.pw-sidebar-review .pw-assist-disclosure summary{padding:5px 6px;border-radius:4px;font-size:.9em}
.pw-sidebar-review .pw-assist-disclosure summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-sidebar-review .pw-assist-report{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:8px 6px 3px;overflow-wrap:anywhere}
.pw-sidebar-review .pw-assist-report h4{margin:5px 0 0;font-size:.95em;font-weight:650}
.pw-guide-steps{display:grid;gap:8px}
.pw-guide-steps li>.pw-note{margin:2px 0 0;color:var(--dsw-alias-label-secondary)}
.pw-sidebar-review .pw-assist-report pre{font-size:.89em;background:var(--dsw-alias-bg-layer-1);border-radius:4px;padding:6px 8px}
.pw-task-action-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px}
.pw-task-action-row .primary{min-height:38px;padding-inline:14px}
.pw-sidebar-detail :is(.pw-task-action-row,.pw-assist-actions)>.pw-button{min-width:0;overflow-wrap:anywhere}
.pw-review-options{display:flex;flex-wrap:wrap;gap:2px 6px;min-width:0}
.pw-review-actions .pw-task-action-row .pw-quiet{font-size:.93em;padding-inline:6px}
.pw-review-actions .pw-progress-form{display:grid;justify-items:start;gap:8px}
.pw-task-picker-head{margin-bottom:12px}
.pw-choice-list{display:grid;gap:4px;max-height:min(46vh,380px);overflow:auto;padding:2px;margin:0 0 10px;overscroll-behavior:contain}
.pw-choice{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:start;gap:9px;min-height:44px;padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l3);cursor:pointer}
.pw-choice[data-selected="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover)}
.pw-choice-copy{display:grid;gap:2px;min-width:0;overflow-wrap:anywhere}
.pw-choice-copy .pw-note{margin:0;font-size:.86em}
.pw-progress{border-top:1px solid var(--dsw-alias-border-l3);padding-top:9px;min-width:0}
.pw-progress-head{min-height:32px;margin-bottom:2px}
.pw-progress-head h3{font-size:1em;margin:0}
.pw-progress-item{border-bottom:1px solid var(--dsw-alias-border-l3)}
.pw-progress-item summary{list-style:none;display:grid;grid-template-columns:minmax(0,1fr) auto;align-content:center;gap:1px 8px;min-height:44px;cursor:pointer;padding:5px 4px}
.pw-progress-item summary:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-progress-item time{grid-column:1;color:var(--dsw-alias-label-secondary);font-size:.82em;line-height:1.3;font-variant-numeric:tabular-nums}
.pw-progress-item summary .pw-preview{grid-column:1;line-height:1.4}
.pw-progress-item summary::after{content:'\u203A';grid-column:2;grid-row:1 / span 2;align-self:center;color:var(--dsw-alias-label-secondary);font-size:1.25em}
.pw-progress-item[open] summary::after{transform:rotate(90deg)}
.pw-progress-detail{padding:4px 8px 10px 12px;border-inline-start:2px solid var(--dsw-alias-border-l3);margin:0 0 8px 4px;overflow-wrap:anywhere}
.pw-progress-detail>.pw-note{font-size:.85em;margin:0 0 5px}
.pw-sidebar-detail .pw-progress{padding-block-start:12px}
.pw-sidebar-detail .pw-progress-head{margin-block-end:4px}
.pw-sidebar-detail .pw-progress-item summary{padding:7px 6px;gap:3px 8px}
.pw-sidebar-detail .pw-progress-item summary .pw-preview{font-size:.95em}
.pw-progress-form{margin:8px 0 4px}
.pw-requirement-fields .pw-field{display:block}
.pw-requirement-fields .pw-textarea[rows="1"]{min-height:34px;padding-block:6px}
.pw-subpage-stack .pw-issues{overflow:visible;flex:none}
.pw-issue-page .pw-updates{max-width:860px}
.pw-viewswitch{display:flex;gap:4px}
.pw-wiki-wrap{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px}
.pw-wiki{flex:1;display:flex;gap:12px;min-height:0;overflow:hidden}
.pw-wiki-list{width:240px;flex:none;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;display:flex;flex-direction:column;gap:4px}
.pw-wiki-item{background:none;border:none;text-align:left;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);padding:6px 8px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere}
.pw-wiki-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-wiki-item.active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary)}
.pw-wiki-group{margin-top:6px}
.pw-wiki-grouhead{display:flex;align-items:center;gap:6px;width:100%;background:none;border:none;font:inherit;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);padding:5px 6px;border-radius:6px;cursor:pointer;text-transform:none}
.pw-wiki-grouhead:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-caret{display:inline-block;font-size:10px;color:var(--dsw-alias-label-tertiary);transition:transform .12s}
.pw-caret.closed{transform:rotate(-90deg)}
.pw-wiki-groupitems{display:flex;flex-direction:column;gap:2px;padding-left:16px}
.pw-wiki-body{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:16px}
.pw-md{max-width:760px;line-height:1.6;font-size:14px}
.pw-md-h{margin:16px 0 8px;line-height:1.3}
.pw-md-p{margin:8px 0}
.pw-md-ul{margin:8px 0;padding-left:22px}
.pw-inline-code{font-family:var(--dsh-font-family-mono,monospace);font-size:.9em;background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px}
.pw-codeblock{margin:10px 0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;overflow:hidden}
.pw-code-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;border-bottom:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-2)}
.pw-code-label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.pw-copy{min-height:22px;padding:0 8px;font-size:11px}
.pw-codeblock pre{margin:0;padding:12px;overflow:auto;font-family:var(--dsh-font-family-mono,monospace);font-size:12px;line-height:1.5;background:var(--dsw-alias-bg-base)}
.pw-md a{color:var(--dsw-alias-brand-primary)}
.pw-md-tablewrap{overflow:auto;margin:10px 0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px}
.pw-md-table{border-collapse:collapse;width:100%;font-size:13px}
.pw-md-table th{background:var(--dsw-alias-bg-layer-2);text-align:left;font-weight:600}
.pw-md-table th,.pw-md-table td{border:1px solid var(--dsw-alias-border-l3);padding:6px 10px;line-height:1.5;vertical-align:top}
.pw-md-table tbody tr:nth-child(even){background:var(--dsw-alias-bg-base)}
@media(max-width:1023px){.pw-board{grid-template-columns:repeat(2,minmax(0,1fr))}.pw-lower{flex-direction:column;max-height:none}}
@media(max-width:767px){.pw-board{grid-template-columns:1fr}.pw-subpage-head{flex-direction:column}}
@media(prefers-reduced-motion:reduce){.pw-page *{transition:none!important}}
`;
  function WorkbenchIcon({ size = 16 }) {
    return h22(
      "svg",
      { width: size, height: size, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true },
      h22("rect", { x: 2, y: 3, width: 4, height: 11, rx: 1, stroke: "currentColor", strokeWidth: 1.4 }),
      h22("rect", { x: 8, y: 3, width: 4, height: 14, rx: 1, stroke: "currentColor", strokeWidth: 1.4 }),
      h22("rect", { x: 14, y: 3, width: 4, height: 8, rx: 1, stroke: "currentColor", strokeWidth: 1.4 })
    );
  }
  var shellCss = `
.pw-shell-body{flex:1;display:flex;gap:12px;min-height:0}
.pw-menu{flex:none;width:170px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:8px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.pw-menu-group{display:flex;flex-direction:column;gap:2px;margin-top:8px}
.pw-menu-grouptitle{font-size:11px;color:var(--dsw-alias-label-tertiary);padding:2px 8px}
.pw-menu-item{border:none;background:none;text-align:left;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);padding:7px 10px;border-radius:6px;cursor:pointer;min-height:32px}
.pw-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-menu-item.active{background:var(--dsw-alias-interactive-bg-active);color:var(--dsw-alias-label-primary);font-weight:500}
.pw-menu-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-content{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.pw-content>.pw-breadcrumb{flex:none}
.pw-home{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;overflow:auto}
.pw-home-title{margin:0 0 10px;font-size:15px}
.pw-home-list{display:flex;flex-direction:column;gap:8px}
.pw-home-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base)}
.pw-home-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pw-home-counts{display:flex;flex-wrap:wrap;gap:10px}
.pw-home-count{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:88px;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.pw-home-count:hover{border-color:var(--dsw-alias-brand-primary)}
.pw-home-count:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pw-home-count strong{font-size:20px}
.pw-home-count span{font-size:12px;color:var(--dsw-alias-label-secondary)}
.pw-list{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow:auto}
.pw-list-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:none}
.pw-list-rows{display:flex;flex-direction:column;gap:8px}
.pw-row{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.pw-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;border:none;background:none;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;padding:4px 6px;border-radius:6px;min-height:44px}
.pw-row-main:hover{background:var(--dsw-alias-interactive-bg-hover)}
.pw-row-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.pw-row-static{cursor:default}
.pw-row-static:hover{background:none}
.pw-row-actions{display:flex;align-items:center;gap:6px;flex:none}
.pw-order{display:inline-flex;flex-direction:column;gap:2px}
.pw-orderbtn{border:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);border-radius:4px;width:22px;height:18px;line-height:1;cursor:pointer;font-size:11px;padding:0}
.pw-orderbtn:disabled{opacity:.4;cursor:not-allowed}
.pw-orderbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.pw-dev-progress{display:flex;align-items:center;gap:8px;min-width:0}
.pw-dev-progress .pw-bar{max-width:120px;flex:none;width:120px}
.pw-startbtn{flex:none}
.pw-source-view{margin:0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-bg-base);font-family:var(--dsh-font-family-mono,monospace);font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto}
.pw-blocked-section{margin-bottom:4px}
.pw-issue .pw-order{flex:none}
@media(max-width:767px){.pw-shell-body{flex-direction:column}.pw-menu{width:auto;flex-direction:row;flex-wrap:wrap;flex:none}.pw-menu-group{flex-direction:row;flex-wrap:wrap;margin-top:0;align-items:center}.pw-menu-grouptitle{display:none}}
`;
  var uiMemory = { picked: null, views: {}, drafts: {}, newRequirements: {}, wikiGen: {}, taskReviews: {} };
  var shellLocale = {
    en: {
      navHome: "Home",
      navRequirements: "Requirements",
      navPool: "Requirement pool",
      navReview: "Review",
      navReady: "Ready",
      navDevelopment: "Development",
      navDev: "In development",
      navBlocked: "Blocked & risks",
      navBoard: "Board",
      navAcceptance: "Acceptance",
      navPending: "Pending acceptance",
      navRecords: "Acceptance records",
      navResources: "Resources",
      navWiki: "Wiki",
      navArch: "Architecture",
      backToPage: "Back to {page}",
      backToPrevious: "Back to previous page",
      homeNeedsYou: "Needs your attention",
      homeProgress: "Project progress",
      homeNothing: "Nothing needs your attention right now.",
      homeIncomplete: "Some project data could not be read. Reminders may be incomplete and progress counts are unavailable. Check the data and retry.",
      runFactsUnavailable: "Task run status could not be read. Permission reminders may be incomplete or out of date. Retry to check again.",
      homeFirstRequirement: "Record your first requirement",
      homeGoReview: "Review",
      homeViewPlan: "View plan",
      homeGoConfirm: "Confirm",
      homeGoAccept: "Accept",
      homeGoHandle: "Handle",
      homeBlockedTasks: "Blocked tasks",
      waitNow: "just now",
      waitMinute: "waiting {n} min",
      waitHour: "waiting {n} h",
      waitDay: "waiting {n} d",
      waitUnknown: "Waiting time unknown",
      authWaitUnknown: "Authorization wait time unknown",
      blockedAndAuthWaitUnknown: "Blocked and authorization wait times unknown",
      confirmationAndAuthWaitUnknown: "Confirmation and authorization wait times unknown",
      blockedWaitWithUnknownAuth: "Blocked: {wait}; authorization wait time unknown",
      confirmationWaitWithUnknownAuth: "Confirmation: {wait}; authorization wait time unknown",
      authRequestWait: "Authorization requested: {wait}",
      blockedWaitWithAuth: "Blocked: {wait}; authorization requested: {auth}",
      confirmationWaitWithAuth: "Confirmation: {wait}; authorization requested: {auth}",
      authRemindersRefreshing: "Updating authorization reminders; combined task reminders may be temporarily hidden.",
      clearFilter: "Clear filters",
      noResults: "No matching results",
      locateBoard: "Find on board",
      submittedAt: "Submitted",
      reviewedAt: "Approved",
      noOpinion: "No notes yet",
      wasReturned: "previously returned",
      reviewEmpty: "No requirements awaiting review. Send one from the board.",
      readyEmpty: "No approved requirements waiting to start.",
      devEmpty: "No requirements in development. Start one from the board.",
      pendingEmpty: "No requirements awaiting acceptance.",
      recordsEmpty: "No acceptance decisions yet.",
      blockedEmpty: "No blocked tasks, pending permissions, failures or recorded risks.",
      devInReview: "{n} awaiting acceptance",
      devBlocked: "{n} blocked",
      noProgress: "No completion rate",
      moveUp: "Move up",
      moveDown: "Move down",
      reorderProgress: "Reordering: {done} of {total} changes saved.",
      reorderFailed: "The order was only partly saved. Retry to finish the same change. If content changed, review the list and start again.",
      reorderRetry: "Continue reordering",
      reorderDiscard: "Review and reorder again",
      blockedSection: "Blocked tasks",
      authSection: "Awaiting permission",
      failureSection: "Execution failures",
      riskSection: "AI-recorded risks",
      viewOriginalTask: "View task",
      viewFailureReason: "View failure",
      deliveryDetail: "This delivery",
      previousReturns: "Earlier return notes",
      recordDetail: "Acceptance decision",
      decisionAt: "Decided",
      recordReadonlyHint: "This is a read-only record of the decision made at that time; later edits do not change it.",
      jumpToRequirement: "Open current requirement",
      recordDecision: "Decision",
      allDecisions: "All decisions",
      wikiSearch: "Search pages",
      sourceOpen: "Open source",
      sourceUnavailable: "This source cannot be opened right now. Check that the file still exists in the project, then retry."
    },
    zh: {
      navHome: "\u9996\u9875",
      navRequirements: "\u9700\u6C42\u7BA1\u7406",
      navPool: "\u9700\u6C42\u6C60",
      navReview: "\u9700\u6C42\u8BC4\u5BA1",
      navReady: "\u5F85\u5F00\u53D1",
      navDevelopment: "\u5F00\u53D1\u7BA1\u7406",
      navDev: "\u5F00\u53D1\u4E2D",
      navBlocked: "\u963B\u585E\u4E0E\u98CE\u9669",
      navBoard: "\u770B\u677F",
      navAcceptance: "\u9A8C\u6536\u7BA1\u7406",
      navPending: "\u5F85\u9A8C\u6536",
      navRecords: "\u9A8C\u6536\u8BB0\u5F55",
      navResources: "\u9879\u76EE\u8D44\u6599",
      navWiki: "Wiki",
      navArch: "\u67B6\u6784",
      backToPage: "\u8FD4\u56DE{page}",
      backToPrevious: "\u8FD4\u56DE\u4E0A\u4E00\u9875",
      homeNeedsYou: "\u9700\u8981\u4F60\u5904\u7406",
      homeProgress: "\u9879\u76EE\u8FDB\u5C55",
      homeNothing: "\u6682\u65F6\u6CA1\u6709\u9700\u8981\u4F60\u5904\u7406\u7684\u4E8B\u9879\u3002",
      homeIncomplete: "\u90E8\u5206\u9879\u76EE\u6570\u636E\u65E0\u6CD5\u8BFB\u53D6\uFF0C\u63D0\u9192\u53EF\u80FD\u4E0D\u5B8C\u6574\uFF0C\u6682\u65F6\u65E0\u6CD5\u7EDF\u8BA1\u9879\u76EE\u8FDB\u5C55\u3002\u8BF7\u68C0\u67E5\u6570\u636E\u540E\u91CD\u8BD5\u3002",
      runFactsUnavailable: "\u65E0\u6CD5\u8BFB\u53D6\u4EFB\u52A1\u8FD0\u884C\u72B6\u6001\uFF0C\u5F85\u6388\u6743\u63D0\u9192\u53EF\u80FD\u4E0D\u5B8C\u6574\u6216\u5DF2\u8FC7\u671F\u3002\u8BF7\u91CD\u8BD5\u3002",
      homeFirstRequirement: "\u8BB0\u5F55\u7B2C\u4E00\u4E2A\u9700\u6C42",
      homeGoReview: "\u53BB\u8BC4\u5BA1",
      homeViewPlan: "\u67E5\u770B\u5B89\u6392",
      homeGoConfirm: "\u53BB\u9A8C\u6536\u4EFB\u52A1",
      homeGoAccept: "\u53BB\u9A8C\u6536",
      homeGoHandle: "\u53BB\u5904\u7406",
      homeBlockedTasks: "\u963B\u585E\u4EFB\u52A1",
      waitNow: "\u521A\u521A",
      waitMinute: "\u5DF2\u7B49\u5F85 {n} \u5206\u949F",
      waitHour: "\u5DF2\u7B49\u5F85 {n} \u5C0F\u65F6",
      waitDay: "\u5DF2\u7B49\u5F85 {n} \u5929",
      waitUnknown: "\u7B49\u5F85\u65F6\u95F4\u672A\u77E5",
      authWaitUnknown: "\u6388\u6743\u7B49\u5F85\u65F6\u95F4\u672A\u77E5",
      blockedAndAuthWaitUnknown: "\u963B\u585E\u548C\u6388\u6743\u7B49\u5F85\u65F6\u95F4\u5747\u672A\u77E5",
      confirmationAndAuthWaitUnknown: "\u786E\u8BA4\u548C\u6388\u6743\u7B49\u5F85\u65F6\u95F4\u5747\u672A\u77E5",
      blockedWaitWithUnknownAuth: "\u963B\u585E\uFF1A{wait}\uFF1B\u6388\u6743\u7B49\u5F85\u65F6\u95F4\u672A\u77E5",
      confirmationWaitWithUnknownAuth: "\u7B49\u5F85\u786E\u8BA4\uFF1A{wait}\uFF1B\u6388\u6743\u7B49\u5F85\u65F6\u95F4\u672A\u77E5",
      authRequestWait: "\u6388\u6743\u8BF7\u6C42\u53D1\u8D77\uFF1A{wait}",
      blockedWaitWithAuth: "\u963B\u585E\uFF1A{wait}\uFF1B\u6388\u6743\u8BF7\u6C42\u53D1\u8D77\uFF1A{auth}",
      confirmationWaitWithAuth: "\u7B49\u5F85\u786E\u8BA4\uFF1A{wait}\uFF1B\u6388\u6743\u8BF7\u6C42\u53D1\u8D77\uFF1A{auth}",
      authRemindersRefreshing: "\u6388\u6743\u63D0\u9192\u6B63\u5728\u66F4\u65B0\uFF0C\u5408\u5E76\u7684\u4EFB\u52A1\u63D0\u9192\u53EF\u80FD\u6682\u65F6\u9690\u85CF\u3002",
      clearFilter: "\u6E05\u7A7A\u7B5B\u9009",
      noResults: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u7ED3\u679C",
      locateBoard: "\u5B9A\u4F4D\u770B\u677F",
      submittedAt: "\u9001\u5BA1\u4E8E",
      reviewedAt: "\u8BC4\u5BA1\u901A\u8FC7\u4E8E",
      noOpinion: "\u6682\u65E0\u610F\u89C1",
      wasReturned: "\u66FE\u88AB\u9000\u56DE",
      reviewEmpty: "\u6682\u65E0\u5F85\u8BC4\u5BA1\u9700\u6C42\uFF0C\u53EF\u5728\u770B\u677F\u9001\u5BA1\u3002",
      readyEmpty: "\u6682\u65E0\u8BC4\u5BA1\u901A\u8FC7\u3001\u7B49\u5F85\u5F00\u59CB\u7684\u9700\u6C42\u3002",
      devEmpty: "\u6682\u65E0\u5F00\u53D1\u4E2D\u7684\u9700\u6C42\uFF0C\u53EF\u5728\u770B\u677F\u5F00\u59CB\u5F00\u53D1\u3002",
      pendingEmpty: "\u6682\u65E0\u5F85\u9A8C\u6536\u7684\u9700\u6C42\u3002",
      recordsEmpty: "\u8FD8\u6CA1\u6709\u9A8C\u6536\u51B3\u5B9A\u3002",
      blockedEmpty: "\u6682\u65E0\u963B\u585E\u4EFB\u52A1\u3001\u5F85\u6388\u6743\u3001\u6267\u884C\u5931\u8D25\u6216\u5DF2\u8BB0\u5F55\u7684\u98CE\u9669\u3002",
      devInReview: "{n} \u4E2A\u5F85\u9A8C\u6536\u4EFB\u52A1",
      devBlocked: "{n} \u4E2A\u963B\u585E",
      noProgress: "\u6682\u65E0\u5B8C\u6210\u7387",
      moveUp: "\u4E0A\u79FB",
      moveDown: "\u4E0B\u79FB",
      reorderProgress: "\u6392\u5E8F\u5DF2\u4FDD\u5B58 {done}/{total} \u9879\u3002",
      reorderFailed: "\u6392\u5E8F\u53EA\u5B8C\u6210\u4E86\u4E00\u90E8\u5206\uFF0C\u53EF\u7EE7\u7EED\u5B8C\u6210\u672C\u6B21\u8C03\u6574\u3002\u82E5\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u67E5\u770B\u5217\u8868\u540E\u518D\u6392\u5E8F\u3002",
      reorderRetry: "\u7EE7\u7EED\u6392\u5E8F",
      reorderDiscard: "\u91CD\u65B0\u67E5\u770B\u5E76\u6392\u5E8F",
      blockedSection: "\u963B\u585E\u4EFB\u52A1",
      authSection: "\u7B49\u5F85\u6388\u6743",
      failureSection: "\u6267\u884C\u5931\u8D25",
      riskSection: "AI \u8BB0\u5F55\u7684\u98CE\u9669",
      viewOriginalTask: "\u67E5\u770B\u539F\u4EFB\u52A1",
      viewFailureReason: "\u67E5\u770B\u5931\u8D25\u539F\u56E0",
      deliveryDetail: "\u672C\u8F6E\u9A8C\u6536\u8BE6\u60C5",
      previousReturns: "\u5386\u53F2\u6253\u56DE\u610F\u89C1",
      recordDetail: "\u9A8C\u6536\u8BB0\u5F55\u8BE6\u60C5",
      decisionAt: "\u51B3\u5B9A\u65F6\u95F4",
      recordReadonlyHint: "\u8FD9\u662F\u5F53\u65F6\u51B3\u5B9A\u7684\u53EA\u8BFB\u8BB0\u5F55\uFF0C\u540E\u7EED\u7F16\u8F91\u4E0D\u4F1A\u6539\u5199\u5B83\u3002",
      jumpToRequirement: "\u67E5\u770B\u5F53\u524D\u9700\u6C42",
      recordDecision: "\u51B3\u5B9A\u7C7B\u578B",
      allDecisions: "\u5168\u90E8\u51B3\u5B9A",
      wikiSearch: "\u641C\u7D22\u9875\u9762",
      sourceOpen: "\u6253\u5F00\u6765\u6E90",
      sourceUnavailable: "\u6682\u65F6\u65E0\u6CD5\u6253\u5F00\u8FD9\u4E2A\u6765\u6E90\u3002\u8BF7\u786E\u8BA4\u9879\u76EE\u4E2D\u7684\u6587\u4EF6\u4ECD\u5B58\u5728\uFF0C\u7136\u540E\u91CD\u8BD5\u3002"
    }
  };
  var index_default = {
    inject: ["slots", "locale", "layout", "connection", "uiSession"],
    apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en: { ...en, ...shellLocale.en }, zh: { ...zh, ...shellLocale.zh } }), "project-workbench: locale");
      const t = ctx.locale.bind(NS);
      const currentSession = {
        getSnapshot: () => ctx.uiSession.adapter.current.getSnapshot().key,
        subscribe: (listener) => ctx.uiSession.adapter.current.subscribe(listener)
      };
      const injected = () => ({
        hooks: { currentSession },
        uiMemory,
        css: css + shellCss,
        showConversation: () => {
          ctx.layout.selectPanel(null);
        },
        openMain: () => {
          ctx.layout.selectPanel(PANEL_ID);
        },
        // V-1: open the session first; openTab needs the session ON SCREEN, so
        // retry briefly and fall back to the two-step flow (never re-submits).
        enterSession: async (sessionId) => {
          const uiWorkspace = ctx.get("uiWorkspace");
          if (!uiWorkspace?.openSession) return { ok: false, tab: false };
          uiWorkspace.openSession(sessionId);
          const right = ctx.get("sidebarRight");
          if (!right) return { ok: true, tab: false };
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 100));
            try {
              right.openTab(PANEL_ID);
              return { ok: true, tab: true };
            } catch {
            }
          }
          return { ok: true, tab: false };
        }
      });
      ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: PANEL_ID, locale: NS, inject: () => injected() }, MainShell));
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 20, label: () => t("panel"), locale: NS }, WorkbenchIcon));
      ctx.inject(["inputTriggers", "sessions"], (conversation) => {
        conversation.effect(() => conversation.inputTriggers.registerSource(workbenchMentionSource(t, WorkbenchIcon)), "project-workbench: @ candidate");
        conversation.slots.inject("conversation.input.dock", () => conversation.slots.register({
          name: "conversation.input.dock",
          id: PANEL_ID,
          locale: NS,
          order: 20,
          inject: (sessionId) => ({ ...injected(), sessionId, eventSource: conversation.sessions.binding(sessionId)?.eventSource })
        }, ConversationDock));
      });
      ctx.inject(["sidebarRight", "sidebarRightTabs"], (right) => {
        right.effect(() => right.sidebarRightTabs.register({
          id: "@local/project-workbench/right",
          kind: PANEL_ID,
          title: () => t("panel"),
          guide: [{ id: PANEL_ID, order: 20, title: () => t("panel"), description: () => t("fallbackDescription"), icon: WorkbenchIcon }]
        }), "project-workbench: right tab type");
        right.slots.inject("sidebar.right.pane.tab", () => right.slots.register({ name: "sidebar.right.pane.tab", key: "@local/project-workbench/right", locale: NS, inject: () => injected() }, TaskPane));
      });
    }
  };
  return __toCommonJS(index_exports);
})();

    return __projectWorkbenchModule.default
  },
})
