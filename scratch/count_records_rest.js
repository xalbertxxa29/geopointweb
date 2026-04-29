


async function countRecords() {
    const url = "https://firestore.googleapis.com/v1/projects/geopint-dea12/databases/(default)/documents:runQuery";
    const body = {
        structuredQuery: {
            from: [{ collectionId: "tareas" }],
            where: {
                compositeFilter: {
                    op: "AND",
                    filters: [
                        {
                            fieldFilter: {
                                field: { fieldPath: "fecha" },
                                op: "GREATER_THAN_OR_EQUAL",
                                value: { stringValue: "2026-04-26T00:00:00-05:00" }
                            }
                        },
                        {
                            fieldFilter: {
                                field: { fieldPath: "fecha" },
                                op: "LESS_THAN_OR_EQUAL",
                                value: { stringValue: "2026-04-27T23:59:59-05:00" }
                            }
                        }
                    ]
                }
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const results = await response.json();
        
        // Firestore runQuery returns an array of objects, each containing a 'document' field if it matched
        // There might be an empty object at the end
        const count = results.filter(r => r.document).length;
        console.log(`TOTAL RECORDS: ${count}`);
        
        // Optional: List some to verify
        // results.slice(0, 5).forEach(r => console.log(r.document.name));
    } catch (err) {
        console.error("Error:", err);
    }
}

countRecords();
