// calendar-ek — EventKit-based calendar CLI for mac-mcp
// Usage:
//   calendar-ek list-calendars
//   calendar-ek get-events --start <iso> --end <iso> [--calendar <name>]
//   calendar-ek create-event --title <t> --start <iso> --end <iso> [--calendar <name>] [--location <l>] [--notes <n>] [--all-day]
//   calendar-ek update-event --id <id> [--title <t>] [--start <iso>] [--end <iso>] [--location <l>] [--notes <n>]
//   calendar-ek delete-event --id <id>

import EventKit
import Foundation

let store = EKEventStore()
let sema  = DispatchSemaphore(value: 0)
var args  = CommandLine.arguments.dropFirst()

func fail(_ msg: String) -> Never {
    fputs("{\"error\":\"\(msg)\"}\n", stderr)
    exit(1)
}

func jsonString(_ s: String?) -> String {
    guard let s else { return "null" }
    let escaped = s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
    return "\"\(escaped)\""
}

func isoDate(_ d: Date?) -> String {
    guard let d else { return "null" }
    return "\"\(ISO8601DateFormatter().string(from: d))\""
}

func parseISO(_ s: String) -> Date? {
    // Try full ISO 8601 with fractional seconds, then without
    let fmt = ISO8601DateFormatter()
    fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = fmt.date(from: s) { return d }
    if let d = ISO8601DateFormatter().date(from: s) { return d }
    // Fall back to date-only or datetime without timezone (assume local time)
    let df = DateFormatter()
    df.locale = Locale(identifier: "en_US_POSIX")
    for pattern in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd"] {
        df.dateFormat = pattern
        if let d = df.date(from: s) { return d }
    }
    return nil
}

func calByName(_ name: String) -> EKCalendar? {
    store.calendars(for: .event).first { $0.title == name }
}

let cmd = args.popFirst() ?? ""

store.requestFullAccessToEvents { granted, _ in
    guard granted else { fail("Calendar access denied") }

    switch cmd {

    case "list-calendars":
        for cal in store.calendars(for: .event).sorted(by: { $0.title < $1.title }) {
            print("{\"name\":\(jsonString(cal.title)),\"id\":\(jsonString(cal.calendarIdentifier)),\"account\":\(jsonString(cal.source.title)),\"type\":\(jsonString(cal.source.sourceType == .local ? "local" : "remote"))}")
        }

    case "get-events":
        var startStr = "", endStr = "", calName: String? = nil
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--start":    startStr = i.next() ?? ""
            case "--end":      endStr   = i.next() ?? ""
            case "--calendar": calName  = i.next()
            default: break
            }
        }
        guard let start = parseISO(startStr) else { fail("Invalid --start date") }
        guard let end   = parseISO(endStr)   else { fail("Invalid --end date") }

        let cals: [EKCalendar]? = calName.map { name in
            guard let c = calByName(name) else { fail("Calendar not found: \(name)") }
            return [c]
        }

        let pred = store.predicateForEvents(withStart: start, end: end, calendars: cals)
        let events = store.events(matching: pred).sorted { $0.startDate < $1.startDate }
        for e in events {
            print("{\"id\":\(jsonString(e.eventIdentifier)),\"title\":\(jsonString(e.title)),\"start\":\(isoDate(e.startDate)),\"end\":\(isoDate(e.endDate)),\"calendar\":\(jsonString(e.calendar.title)),\"account\":\(jsonString(e.calendar.source.title)),\"location\":\(jsonString(e.location)),\"notes\":\(jsonString(e.notes)),\"all_day\":\(e.isAllDay),\"url\":\(jsonString(e.url?.absoluteString))}")
        }

    case "create-event":
        var title = "", startStr = "", endStr = ""
        var calName: String? = nil
        var location: String? = nil
        var notes: String? = nil
        var allDay = false
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--title":    title    = i.next() ?? ""
            case "--start":    startStr = i.next() ?? ""
            case "--end":      endStr   = i.next() ?? ""
            case "--calendar": calName  = i.next()
            case "--location": location = i.next()
            case "--notes":    notes    = i.next()
            case "--all-day":  allDay   = true
            default: break
            }
        }
        guard !title.isEmpty                  else { fail("--title required") }
        guard let start = parseISO(startStr)  else { fail("Invalid --start date") }
        guard let end   = parseISO(endStr)    else { fail("Invalid --end date") }

        let cal: EKCalendar
        if let name = calName {
            guard let c = calByName(name) else { fail("Calendar not found: \(name)") }
            cal = c
        } else {
            guard let c = store.defaultCalendarForNewEvents else { fail("No default calendar") }
            cal = c
        }

        let e = EKEvent(eventStore: store)
        e.title     = title
        e.startDate = start
        e.endDate   = end
        e.calendar  = cal
        e.location  = location
        e.notes     = notes
        e.isAllDay  = allDay
        do {
            try store.save(e, span: .thisEvent, commit: true)
            print("{\"id\":\(jsonString(e.eventIdentifier)),\"title\":\(jsonString(e.title)),\"calendar\":\(jsonString(cal.title))}")
        } catch { fail("Save failed: \(error.localizedDescription)") }

    case "update-event":
        var id = "", title: String? = nil, startStr: String? = nil, endStr: String? = nil
        var location: String? = nil, notes: String? = nil
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--id":       id       = i.next() ?? ""
            case "--title":    title    = i.next()
            case "--start":    startStr = i.next()
            case "--end":      endStr   = i.next()
            case "--location": location = i.next()
            case "--notes":    notes    = i.next()
            default: break
            }
        }
        guard !id.isEmpty else { fail("--id required") }
        guard let e = store.event(withIdentifier: id) else { fail("Event not found: \(id)") }
        if let t = title    { e.title     = t }
        if let s = startStr, let d = parseISO(s) { e.startDate = d }
        if let s = endStr,   let d = parseISO(s) { e.endDate   = d }
        if let l = location { e.location  = l }
        if let n = notes    { e.notes     = n }
        do {
            try store.save(e, span: .thisEvent, commit: true)
            print("{\"ok\":true,\"id\":\(jsonString(id))}")
        } catch { fail("Save failed: \(error.localizedDescription)") }

    case "delete-event":
        var id = ""
        var i = args.makeIterator()
        while let a = i.next() { if a == "--id" { id = i.next() ?? "" } }
        guard !id.isEmpty else { fail("--id required") }
        guard let e = store.event(withIdentifier: id) else { fail("Event not found: \(id)") }
        do {
            try store.remove(e, span: .thisEvent, commit: true)
            print("{\"ok\":true,\"id\":\(jsonString(id))}")
        } catch { fail("Remove failed: \(error.localizedDescription)") }

    default:
        fail("Unknown command: \(cmd)")
    }

    sema.signal()
}
sema.wait()
