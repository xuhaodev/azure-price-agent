/**
 * Test script for query broadening logic
 * This tests the progressive fuzzy broadening strategy
 */

// Mock broadenQuery function for testing
function broadenQuery(filter: string): string | null {
    // Extract region part (keep it unchanged)
    const regionMatch = filter.match(/armRegionName eq '[^']+'/);
    const regionPart = regionMatch ? regionMatch[0] : '';
    
    // Extract all contains clauses
    const containsPattern = /contains\(tolower\((productName|meterName)\),\s*'([^']+)'\)/gi;
    const matches = Array.from(filter.matchAll(containsPattern));
    
    if (matches.length === 0) {
        return null; // Cannot broaden further
    }
    
    // Group by field name (productName vs meterName)
    const productNameClauses: string[] = [];
    const meterNameClauses: string[] = [];
    
    for (const match of matches) {
        const fieldName = match[1].toLowerCase();
        const keyword = match[2];
        if (fieldName === 'productname') {
            productNameClauses.push(keyword);
        } else if (fieldName === 'metername') {
            meterNameClauses.push(keyword);
        }
    }
    
    // Try to remove last meterName keyword first, then productName
    let newClauses: string[] = [];
    
    if (meterNameClauses.length > 1) {
        // Remove last meterName keyword, keep productName
        const shortenedMeterName = meterNameClauses.slice(0, -1);
        newClauses = [
            ...productNameClauses.map(k => `contains(tolower(productName), '${k}')`),
            ...shortenedMeterName.map(k => `contains(tolower(meterName), '${k}')`)
        ];
    } else if (meterNameClauses.length === 1) {
        if (productNameClauses.length > 0) {
            // Remove productName, keep the single meterName keyword
            newClauses = meterNameClauses.map(k => `contains(tolower(meterName), '${k}')`);
        } else {
            // Only one meterName keyword and no productName, cannot broaden further
            return null;
        }
    } else if (productNameClauses.length > 1) {
        // Only productName clauses exist (no meterName), remove last one
        const shortenedProductName = productNameClauses.slice(0, -1);
        newClauses = shortenedProductName.map(k => `contains(tolower(productName), '${k}')`);
    } else {
        // Only one clause remaining (single productName or no clauses), cannot broaden
        return null;
    }
    
    // Reconstruct query
    const parts = [];
    if (regionPart) {
        parts.push(regionPart);
    }
    parts.push(...newClauses);
    
    return parts.join(' and ');
}

// Test cases
const testCases = [
    {
        name: "GPT-5 Mini with productName - 3 keywords",
        query: "armRegionName eq 'eastus2' and contains(tolower(productName), 'openai') and contains(tolower(meterName), 'gpt') and contains(tolower(meterName), '5') and contains(tolower(meterName), 'mini')",
        expectedAttempts: [
            "armRegionName eq 'eastus2' and contains(tolower(productName), 'openai') and contains(tolower(meterName), 'gpt') and contains(tolower(meterName), '5')",
            "armRegionName eq 'eastus2' and contains(tolower(productName), 'openai') and contains(tolower(meterName), 'gpt')",
            "armRegionName eq 'eastus2' and contains(tolower(meterName), 'gpt')",
            null
        ]
    },
    {
        name: "VM size without productName - 3 keywords",
        query: "armRegionName eq 'eastus' and contains(tolower(meterName), 'd8s') and contains(tolower(meterName), 'v5') and contains(tolower(meterName), 'spot')",
        expectedAttempts: [
            "armRegionName eq 'eastus' and contains(tolower(meterName), 'd8s') and contains(tolower(meterName), 'v5')",
            "armRegionName eq 'eastus' and contains(tolower(meterName), 'd8s')",
            null
        ]
    },
    {
        name: "Single keyword with productName",
        query: "armRegionName eq 'westus' and contains(tolower(productName), 'storage') and contains(tolower(meterName), 'premium')",
        expectedAttempts: [
            "armRegionName eq 'westus' and contains(tolower(meterName), 'premium')",
            null
        ]
    }
];

console.log("Testing Query Broadening Strategy\n");
console.log("=".repeat(80));

for (const testCase of testCases) {
    console.log(`\nTest: ${testCase.name}`);
    console.log("-".repeat(80));
    console.log(`Original: ${testCase.query}`);
    
    let currentQuery = testCase.query;
    let attempt = 0;
    
    while (attempt < testCase.expectedAttempts.length) {
        const broadened = broadenQuery(currentQuery);
        const expected = testCase.expectedAttempts[attempt];
        
        console.log(`\nAttempt ${attempt + 1}:`);
        console.log(`  Expected: ${expected || 'null (cannot broaden further)'}`);
        console.log(`  Got:      ${broadened || 'null (cannot broaden further)'}`);
        console.log(`  Status:   ${broadened === expected ? '✅ PASS' : '❌ FAIL'}`);
        
        if (broadened === null) {
            break;
        }
        
        currentQuery = broadened;
        attempt++;
    }
}

console.log("\n" + "=".repeat(80));
console.log("Test complete!");
