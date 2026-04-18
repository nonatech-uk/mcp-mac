#!/usr/bin/env swift
// reminders-ek — EventKit-based reminders CLI for mac-mcp
// Usage:
//   reminders-ek list-lists
//   reminders-ek get [--list <name>] [--include-completed]
//   reminders-ek create --title <t> [--list <name>] [--due <iso8601>] [--notes <n>] [--priority <0|1|5|9>]
//   reminders-ek complete --id <id>
//   reminders-ek delete --id <id>
//
// Output: newline-delimited JSON objects

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
    let fmt = ISO8601DateFormatter()
    return "\"\(fmt.string(from: d))\""
}

func calByName(_ name: String) -> EKCalendar? {
    store.calendars(for: .reminder).first { $0.title == name }
}

let cmd = args.popFirst() ?? ""

store.requestFullAccessToReminders { granted, _ in
    guard granted else { fail("Reminders access denied") }

    switch cmd {

    case "list-lists":
        for cal in store.calendars(for: .reminder).sorted(by: { $0.title < $1.title }) {
            print("{\"name\":\(jsonString(cal.title)),\"id\":\(jsonString(cal.calendarIdentifier)),\"account\":\(jsonString(cal.source.title))}")
        }

    case "get":
        var listName: String? = nil
        var includeCompleted = false
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--list":              listName = i.next()
            case "--include-completed": includeCompleted = true
            default: break
            }
        }

        let cals: [EKCalendar]
        if let name = listName {
            guard let cal = calByName(name) else { fail("List not found: \(name)") }
            cals = [cal]
        } else {
            cals = store.calendars(for: .reminder)
        }

        let pred = store.predicateForReminders(in: cals)
        store.fetchReminders(matching: pred) { reminders in
            for r in (reminders ?? []) {
                if !includeCompleted && r.isCompleted { continue }
                let priority: Int
                switch r.priority {
                case 1: priority = 1
                case 5: priority = 5
                case 9: priority = 9
                default: priority = 0
                }
                print("{\"id\":\(jsonString(r.calendarItemIdentifier)),\"title\":\(jsonString(r.title)),\"list\":\(jsonString(r.calendar.title)),\"account\":\(jsonString(r.calendar.source.title)),\"completed\":\(r.isCompleted),\"due_date\":\(isoDate(r.dueDateComponents?.date)),\"notes\":\(jsonString(r.notes)),\"priority\":\(priority)}")
            }
            sema.signal()
        }
        sema.wait()
        exit(0)

    case "create":
        var title    = ""
        var listName = "Inbox"
        var dueISO:  String? = nil
        var notes:   String? = nil
        var priority = 0
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--title":    title    = i.next() ?? ""
            case "--list":     listName = i.next() ?? listName
            case "--due":      dueISO   = i.next()
            case "--notes":    notes    = i.next()
            case "--priority": priority = Int(i.next() ?? "0") ?? 0
            default: break
            }
        }
        guard !title.isEmpty else { fail("--title required") }
        guard let cal = calByName(listName) else { fail("List not found: \(listName)") }

        let r = EKReminder(eventStore: store)
        r.title    = title
        r.calendar = cal
        r.notes    = notes
        r.priority = priority
        if let iso = dueISO {
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let date = fmt.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
            if let d = date {
                var comps = Calendar.current.dateComponents([.year,.month,.day,.hour,.minute,.second], from: d)
                comps.timeZone = TimeZone.current
                r.dueDateComponents = comps
            }
        }
        do {
            try store.save(r, commit: true)
            print("{\"id\":\(jsonString(r.calendarItemIdentifier)),\"title\":\(jsonString(r.title)),\"list\":\(jsonString(cal.title))}")
        } catch {
            fail("Save failed: \(error.localizedDescription)")
        }

    case "complete":
        var id = ""
        var i = args.makeIterator()
        while let a = i.next() { if a == "--id" { id = i.next() ?? "" } }
        guard !id.isEmpty else { fail("--id required") }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { fail("Reminder not found: \(id)") }
        r.isCompleted = true
        r.completionDate = Date()
        do {
            try store.save(r, commit: true)
            print("{\"ok\":true,\"id\":\(jsonString(id))}")
        } catch { fail("Save failed: \(error.localizedDescription)") }

    case "delete":
        var id = ""
        var i = args.makeIterator()
        while let a = i.next() { if a == "--id" { id = i.next() ?? "" } }
        guard !id.isEmpty else { fail("--id required") }
        guard let r = store.calendarItem(withIdentifier: id) as? EKReminder else { fail("Reminder not found: \(id)") }
        do {
            try store.remove(r, commit: true)
            print("{\"ok\":true,\"id\":\(jsonString(id))}")
        } catch { fail("Remove failed: \(error.localizedDescription)") }

    default:
        fail("Unknown command: \(cmd)")
    }

    if cmd != "get" { sema.signal() }
}
sema.wait()
