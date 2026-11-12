# Ingesting records with the OpenTelemetry Collector

Skeld's JSON lines map onto the OpenTelemetry log data model as [record-format.md](record-format.md#keys) lists. [collector.yaml](collector.yaml) is a Collector configuration that reads those lines from a file and sets each mapped field.

This is verified with contrib v0.165.0 and this configuration.

## Run it

Write the server's stdout to a file, then point the Collector at that file and at an output path:

```sh
node server.ts >> skeld.log
```

```sh
SKELD_LOG_FILE="$PWD/skeld.log" SKELD_OTEL_OUT="$PWD/otel.jsonl" otelcol-contrib --config docs/logging/collector.yaml
```

`otel.jsonl` receives the records as OTLP JSON. The configuration exports to a file only; to send records elsewhere, replace the `file` exporter with your own, which is outside what is verified here.

## What the configuration does

| Step | Component                                                                                    | Effect                                                                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `file_log` receiver, from the beginning of `SKELD_LOG_FILE`, without the file-name attribute | one log record per line                                                                                                                                                                           |
| 2    | `json_parser` with `parse_ints: true`                                                        | every key of the line becomes an attribute; integers stay integers                                                                                                                                |
| 3    | its `timestamp` block on `time`                                                              | Timestamp, to the millisecond                                                                                                                                                                     |
| 4    | `trace_parser`, only when `trace_id` is present                                              | TraceId from `trace_id`, TraceFlags from `trace_flags`                                                                                                                                            |
| 5    | `transform` processor                                                                        | SeverityNumber, SeverityText and EventName from their keys; Body from `message` on author records, empty on automatic records; then the keys used in steps 3 to 5 are removed from the attributes |
| 6    | `file` exporter to `SKELD_OTEL_OUT`                                                          | OTLP JSON lines                                                                                                                                                                                   |

## Fields observed

From four lines written by Skeld, two of them with trace context:

| Destination field | Value observed                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Timestamp         | the instant of `time`, in nanoseconds                                                                                                                                                                   |
| SeverityNumber    | `severity_number`, as an integer                                                                                                                                                                        |
| SeverityText      | `severity_text`, as a string                                                                                                                                                                            |
| EventName         | `event_name`, as a string                                                                                                                                                                               |
| Body              | `message` as a string on author records; empty on records without `message`                                                                                                                             |
| TraceId           | `trace_id`, as the same 16 bytes; absent on records without trace context                                                                                                                               |
| TraceFlags        | `trace_flags`, as an integer; absent on records without trace context                                                                                                                                   |
| Attributes        | every other key under its own name: `skeld.request_id` a string, `http.request.header.x-request-id` an array of one string, integers as integers, `fields` a map with an error field as a map inside it |

Not set by Skeld's lines: SpanId, which Skeld does not write, and the resource. Set `service.name` and other resource attributes in your Collector configuration.
