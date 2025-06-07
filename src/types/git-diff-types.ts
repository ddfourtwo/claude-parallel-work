/**
 * Git Diff Type Definitions
 * 
 * Types for Git-based container diff tracking system
 */

export interface GitDiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface GitDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions?: number;
  deletions?: number;
  oldPath?: string; // For renamed files
}

export interface GitDiff {
  id: string;
  containerId: string;
  patch: string;
  summary: string;
  files: GitDiffFile[];
  stats: GitDiffStats;
  timestamp: Date;
  binaryFiles?: string[]; // List of binary files that changed
  workspace?: string; // Original workspace path
  
  // Revision tracking
  revisionHistory?: RevisionEntry[];
  sessionId?: string; // Claude CLI session ID for revisions
  originalTaskId?: string; // Original task that created this diff
  isRevision?: boolean;
  parentDiffId?: string; // If this is a revision, points to parent
}

export interface GitInitOptions {
  userEmail?: string;
  userName?: string;
  safeDirs?: string[];
}

export interface GitDiffOptions {
  includeBinary?: boolean;
  contextLines?: number;
  ignoreWhitespace?: boolean;
}

export interface GitDiffExtractResult {
  success: boolean;
  diff?: GitDiff;
  error?: string;
  logs?: string[];
}

export interface RevisionEntry {
  timestamp: Date;
  feedback: string;
  diffId: string; // The diff ID created from this revision
  revisionNumber: number;
}

export interface ContainerSession {
  sessionId: string;
  containerId: string;
  workspaceState: string; // Path to preserved workspace
  originalPrompt: string;
  lastPrompt: string;
  revisionCount: number;
  status: 'active' | 'hibernated' | 'terminated';
  taskId: string;
  diffId: string;
  lastActivity: Date;
  dockerContainer: any; // Docker container instance
}

export interface RevisionRequest {
  diffId: string;
  feedback: string;
  preserveCorrectParts?: boolean;
  additionalContext?: string;
}

export interface RevisionResult {
  success: boolean;
  newDiffId?: string;
  taskId?: string;
  error?: string;
  revisionCount?: number;
}