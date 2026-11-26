// Does:  Declares the limiter's options, its rules and the scope members it registers through.
// Holds: LimitScope names each member it uses, so a server with any gate satisfies it.

import type { RouteDefinition } from '@skeld/core/contract';
import type { OnRequestHook, RegisterOptions, RouteInfo, Scope } from '@skeld/core/server';
import type { Database } from '../database/types.ts';

/** The options of `limitRoutes`. */
export interface LimitOptions {
  /** The database that holds the counters; its plugin is registered before `limitRoutes`. */
  readonly database: Database;
  /** The rules by name: a lower-case letter, then letters, digits, `.`, `_` or `-`, 64 characters at most. */
  readonly rules: { readonly [name: string]: LimitRule };
  /** Time one charge may take, in milliseconds, from 1 to 2,147,483,647 (default 1,000). */
  readonly chargeTimeoutMs?: number;
}

/** A limit shared by its routes: `max` requests per address in each window. */
export interface LimitRule {
  /** Requests allowed in one window, from 1 to 1,000,000. */
  readonly max: number;
  /** The window's length in seconds, from 1 to 86,400. */
  readonly windowSeconds: number;
  /** The contract's routes the rule covers; a route belongs to one rule at most. */
  readonly routes: readonly Pick<RouteDefinition, 'method' | 'path'>[];
}

/** The scope members the limiter's boot step reads. */
export type BootScope = Pick<Scope, 'signal' | 'log' | 'event'>;

/** The scope members `limitRoutes` registers through; a server or a plugin's scope has them. */
export interface LimitScope {
  /** Adds the limiter's `onRequest` hook. */
  addHook(name: 'onRequest', hook: OnRequestHook): void;
  /** Adds the limiter's boot step. */
  register(plugin: (scope: BootScope) => Promise<void>, options?: RegisterOptions): void;
  /** Adds the limiter's route check. */
  onRoutes(callback: (routes: readonly RouteInfo[]) => void): void;
}
