/*
 * The Core Services layer — one barrel (Core API Focus List).
 * ---------------------------------------------------------------------------
 * Apps are surfaces; Cores are the shared contracts underneath. Import Core
 * behavior from here (or a specific Core module) instead of rebuilding it.
 */

export * from "./registry";
export * as timeCore from "./time";
export * as cardspokeCore from "./cardspoke";
export * as editorCore from "./editor";
export * as filesCore from "./files";
export * as searchCore from "./searchIndex";
export * as peopleCore from "./people";
export * as monitorCore from "./monitor";
export * as webCore from "./web";
export * as aiCore from "./ai";
export * as secretsCore from "./secrets";
export * as securityCore from "./security";
export * as notificationCore from "./notification";
export * as mediaCore from "./media";
export * as devCore from "./dev";
