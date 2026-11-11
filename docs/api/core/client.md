# @darkstart/core/client

## CallInput

What a route call takes: each request part the route declares, in its JSON form.

```ts
export type CallInput<R extends RouteDefinition> = (R extends { readonly params: infer S extends Schema }
  ? { readonly params: Wire<S> }
  : unknown) &
  (R extends { readonly query: infer S extends Schema } ? { readonly query: Wire<S> } : unknown) &
  (R extends { readonly headers: infer S extends Schema } ? { readonly headers: Wire<S> } : unknown) &
  (R extends { readonly body: infer S extends Schema } ? { readonly body: Wire<S> } : unknown);
```

Source: `packages/core/src/client/types.ts:422`

## CallResult

What a route call resolves with: the status, the headers and the body.

For a status the contract declares with a schema the body has passed its check; for any other it is unchecked.

```ts
export type CallResult<R extends RouteDefinition> =
  | {
      [S in keyof R['responses']]: {
        readonly status: S;
        readonly headers: Headers;
        readonly body: R['responses'][S] extends Schema ? Wire<R['responses'][S]> : null;
      };
    }[keyof R['responses']]
  | {
      readonly status: Exclude<FetchStatus, keyof R['responses']>;
      readonly headers: Headers;
      readonly body: unknown;
    };
```

| Field     | Summary                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------- |
| `status`  | The response status.                                                                           |
| `headers` | The response headers.                                                                          |
| `body`    | The response body; for a status the contract does not declare, unchecked JSON, text or `null`. |

Source: `packages/core/src/client/types.ts:433`

## Client

A typed client: one `RouteCall` per route name of the contract.

```ts
export type Client<C extends ContractRoutes> = { readonly [K in keyof C]: RouteCall<C[K]> };
```

Source: `packages/core/src/client/types.ts:463`

## ClientOptions

The options of `createClient`.

```ts
export interface ClientOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: typeof globalThis.fetch;
}
```

| Field     | Summary                                                                                      |
| --------- | -------------------------------------------------------------------------------------------- |
| `baseUrl` | The service's origin and base path: an absolute http or https URL with no query or fragment. |
| `fetch`   | The function that sends each request (default `globalThis.fetch`).                           |

Source: `packages/core/src/client/types.ts:8`

## FetchStatus

Every status from 200 to 599, the range a call can resolve with.

```ts
export type FetchStatus =
  | 200
  | 201
  | 202
  | 203
  | 204
  | 205
  | 206
  | 207
  | 208
  | 209
  | 210
  | 211
  | 212
  | 213
  | 214
  | 215
  | 216
  | 217
  | 218
  | 219
  | 220
  | 221
  | 222
  | 223
  | 224
  | 225
  | 226
  | 227
  | 228
  | 229
  | 230
  | 231
  | 232
  | 233
  | 234
  | 235
  | 236
  | 237
  | 238
  | 239
  | 240
  | 241
  | 242
  | 243
  | 244
  | 245
  | 246
  | 247
  | 248
  | 249
  | 250
  | 251
  | 252
  | 253
  | 254
  | 255
  | 256
  | 257
  | 258
  | 259
  | 260
  | 261
  | 262
  | 263
  | 264
  | 265
  | 266
  | 267
  | 268
  | 269
  | 270
  | 271
  | 272
  | 273
  | 274
  | 275
  | 276
  | 277
  | 278
  | 279
  | 280
  | 281
  | 282
  | 283
  | 284
  | 285
  | 286
  | 287
  | 288
  | 289
  | 290
  | 291
  | 292
  | 293
  | 294
  | 295
  | 296
  | 297
  | 298
  | 299
  | 300
  | 301
  | 302
  | 303
  | 304
  | 305
  | 306
  | 307
  | 308
  | 309
  | 310
  | 311
  | 312
  | 313
  | 314
  | 315
  | 316
  | 317
  | 318
  | 319
  | 320
  | 321
  | 322
  | 323
  | 324
  | 325
  | 326
  | 327
  | 328
  | 329
  | 330
  | 331
  | 332
  | 333
  | 334
  | 335
  | 336
  | 337
  | 338
  | 339
  | 340
  | 341
  | 342
  | 343
  | 344
  | 345
  | 346
  | 347
  | 348
  | 349
  | 350
  | 351
  | 352
  | 353
  | 354
  | 355
  | 356
  | 357
  | 358
  | 359
  | 360
  | 361
  | 362
  | 363
  | 364
  | 365
  | 366
  | 367
  | 368
  | 369
  | 370
  | 371
  | 372
  | 373
  | 374
  | 375
  | 376
  | 377
  | 378
  | 379
  | 380
  | 381
  | 382
  | 383
  | 384
  | 385
  | 386
  | 387
  | 388
  | 389
  | 390
  | 391
  | 392
  | 393
  | 394
  | 395
  | 396
  | 397
  | 398
  | 399
  | 400
  | 401
  | 402
  | 403
  | 404
  | 405
  | 406
  | 407
  | 408
  | 409
  | 410
  | 411
  | 412
  | 413
  | 414
  | 415
  | 416
  | 417
  | 418
  | 419
  | 420
  | 421
  | 422
  | 423
  | 424
  | 425
  | 426
  | 427
  | 428
  | 429
  | 430
  | 431
  | 432
  | 433
  | 434
  | 435
  | 436
  | 437
  | 438
  | 439
  | 440
  | 441
  | 442
  | 443
  | 444
  | 445
  | 446
  | 447
  | 448
  | 449
  | 450
  | 451
  | 452
  | 453
  | 454
  | 455
  | 456
  | 457
  | 458
  | 459
  | 460
  | 461
  | 462
  | 463
  | 464
  | 465
  | 466
  | 467
  | 468
  | 469
  | 470
  | 471
  | 472
  | 473
  | 474
  | 475
  | 476
  | 477
  | 478
  | 479
  | 480
  | 481
  | 482
  | 483
  | 484
  | 485
  | 486
  | 487
  | 488
  | 489
  | 490
  | 491
  | 492
  | 493
  | 494
  | 495
  | 496
  | 497
  | 498
  | 499
  | 500
  | 501
  | 502
  | 503
  | 504
  | 505
  | 506
  | 507
  | 508
  | 509
  | 510
  | 511
  | 512
  | 513
  | 514
  | 515
  | 516
  | 517
  | 518
  | 519
  | 520
  | 521
  | 522
  | 523
  | 524
  | 525
  | 526
  | 527
  | 528
  | 529
  | 530
  | 531
  | 532
  | 533
  | 534
  | 535
  | 536
  | 537
  | 538
  | 539
  | 540
  | 541
  | 542
  | 543
  | 544
  | 545
  | 546
  | 547
  | 548
  | 549
  | 550
  | 551
  | 552
  | 553
  | 554
  | 555
  | 556
  | 557
  | 558
  | 559
  | 560
  | 561
  | 562
  | 563
  | 564
  | 565
  | 566
  | 567
  | 568
  | 569
  | 570
  | 571
  | 572
  | 573
  | 574
  | 575
  | 576
  | 577
  | 578
  | 579
  | 580
  | 581
  | 582
  | 583
  | 584
  | 585
  | 586
  | 587
  | 588
  | 589
  | 590
  | 591
  | 592
  | 593
  | 594
  | 595
  | 596
  | 597
  | 598
  | 599;
```

Source: `packages/core/src/client/types.ts:19`

## RouteCall

The function a client gives for one route.

It resolves for every status from 200 to 599; it rejects with HttpError `NETWORK` or `INVALID_RESPONSE`.

```ts
export type RouteCall<R extends RouteDefinition> = R extends
  | { readonly params: Schema }
  | { readonly query: Schema }
  | { readonly headers: Schema }
  | { readonly body: Schema }
  ? (input: CallInput<R>) => Promise<CallResult<R>>
  : (input?: Empty) => Promise<CallResult<R>>;
```

Source: `packages/core/src/client/types.ts:454`

## createClient

Creates a typed client with one call per route of a contract.

A call rejects with HttpError `INVALID_RESPONSE` when a declared body fails its schema; throws `TypeError` for a bad `baseUrl`.

```ts
export function createClient<const C extends ContractRoutes>(contract: C, options: ClientOptions): Client<C>;
```

```ts
createClient(defineContract({ health: { method: 'GET', path: '/health', responses: { 204: null } } }), {
  baseUrl: 'http://127.0.0.1:3000',
});
```

Source: `packages/core/src/client/client.ts:187`
