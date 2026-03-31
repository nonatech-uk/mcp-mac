#!/usr/bin/env swift
// contacts-ek — Contacts framework CLI for mac-mcp
// Usage:
//   contacts-ek search --query <q> [--limit <n>]
//   contacts-ek get --id <id>
//
// Output: newline-delimited JSON objects

import Contacts
import Foundation

let store = CNContactStore()
let sema  = DispatchSemaphore(value: 0)
var args  = CommandLine.arguments.dropFirst()

func fail(_ msg: String) -> Never {
    fputs("{\"error\":\"\(msg)\"}\n", stderr)
    exit(1)
}

func jsonString(_ s: String?) -> String {
    guard let s, !s.isEmpty else { return "null" }
    let escaped = s
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
        .replacingOccurrences(of: "\t", with: "\\t")
    return "\"\(escaped)\""
}

func jsonLabeledValue(_ lv: CNLabeledValue<NSString>) -> String {
    let label = lv.label.map { CNLabeledValue<NSString>.localizedString(forLabel: $0) } ?? ""
    let value = lv.value as String
    return "{\"label\":\(jsonString(label)),\"value\":\(jsonString(value))}"
}

func jsonPhone(_ lv: CNLabeledValue<CNPhoneNumber>) -> String {
    let label = lv.label.map { CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: $0) } ?? ""
    return "{\"label\":\(jsonString(label)),\"value\":\(jsonString(lv.value.stringValue))}"
}

func jsonAddress(_ lv: CNLabeledValue<CNPostalAddress>) -> String {
    let a = lv.value
    let label = lv.label.map { CNLabeledValue<CNPostalAddress>.localizedString(forLabel: $0) } ?? ""
    var parts: [String] = []
    if !a.street.isEmpty  { parts.append(a.street) }
    if !a.city.isEmpty    { parts.append(a.city) }
    if !a.state.isEmpty   { parts.append(a.state) }
    if !a.postalCode.isEmpty { parts.append(a.postalCode) }
    if !a.country.isEmpty { parts.append(a.country) }
    return "{\"label\":\(jsonString(label)),\"value\":\(jsonString(parts.joined(separator: ", ")))}"
}

let baseKeys: [CNKeyDescriptor] = [
    CNContactIdentifierKey as CNKeyDescriptor,
    CNContactGivenNameKey as CNKeyDescriptor,
    CNContactFamilyNameKey as CNKeyDescriptor,
    CNContactMiddleNameKey as CNKeyDescriptor,
    CNContactOrganizationNameKey as CNKeyDescriptor,
    CNContactEmailAddressesKey as CNKeyDescriptor,
    CNContactPhoneNumbersKey as CNKeyDescriptor,
    CNContactPostalAddressesKey as CNKeyDescriptor,
]

func printContact(_ c: CNContact) {
    let nameParts = [c.givenName, c.middleName, c.familyName].filter { !$0.isEmpty }
    let name = nameParts.isEmpty ? c.organizationName : nameParts.joined(separator: " ")

    let emails = c.emailAddresses.map { jsonLabeledValue($0) }.joined(separator: ",")
    let phones = c.phoneNumbers.map  { jsonPhone($0) }.joined(separator: ",")
    let addrs  = c.postalAddresses.map { jsonAddress($0) }.joined(separator: ",")

    print("{\"id\":\(jsonString(c.identifier)),\"name\":\(jsonString(name)),\"organisation\":\(jsonString(c.organizationName)),\"emails\":[\(emails)],\"phones\":[\(phones)],\"addresses\":[\(addrs)]}")
}

let cmd = args.popFirst() ?? ""

store.requestAccess(for: .contacts) { granted, _ in
    guard granted else { fail("Contacts access denied") }

    switch cmd {

    case "search":
        var query = ""
        var limit = 20
        var i = args.makeIterator()
        while let a = i.next() {
            switch a {
            case "--query": query = i.next() ?? ""
            case "--limit": limit = Int(i.next() ?? "20") ?? 20
            default: break
            }
        }
        guard !query.isEmpty else { fail("--query required") }

        // Search by name, email, and phone — merge results by identifier
        var seen = Set<String>()
        var results: [CNContact] = []

        let predicates: [NSPredicate] = [
            CNContact.predicateForContacts(matchingName: query),
            CNContact.predicateForContacts(matchingEmailAddress: query),
        ]

        for pred in predicates {
            let found = (try? store.unifiedContacts(matching: pred, keysToFetch: baseKeys)) ?? []
            for c in found {
                if seen.insert(c.identifier).inserted {
                    results.append(c)
                }
            }
        }

        // Also search phone if query looks like it could be a number
        if query.contains(where: { $0.isNumber }) {
            let phonePred = CNContact.predicateForContacts(matching: CNPhoneNumber(stringValue: query))
            let found = (try? store.unifiedContacts(matching: phonePred, keysToFetch: baseKeys)) ?? []
            for c in found {
                if seen.insert(c.identifier).inserted {
                    results.append(c)
                }
            }
        }

        for c in results.prefix(limit) {
            printContact(c)
        }

    case "get":
        var id = ""
        var i = args.makeIterator()
        while let a = i.next() { if a == "--id" { id = i.next() ?? "" } }
        guard !id.isEmpty else { fail("--id required") }

        do {
            let c = try store.unifiedContact(withIdentifier: id, keysToFetch: baseKeys)
            printContact(c)
        } catch {
            fail("Contact not found: \(id)")
        }

    default:
        fail("Unknown command: \(cmd)")
    }

    sema.signal()
}
sema.wait()
