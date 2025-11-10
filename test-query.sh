#!/bin/bash

# Test Azure Retail Prices API queries

echo "=== Testing D8s v4 VM queries ==="
echo ""

echo "1. Testing with SPACE (D8s v4) - Should return 0 results:"
curl -s 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20%27eastus%27%20and%20contains(serviceName,%20%27Virtual%20Machines%27)%20and%20contains(armSkuName,%20%27D8s%20v4%27)%20and%20priceType%20eq%20%27Consumption%27' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'Count: {len(data.get(\"Items\", []))}')"

echo ""
echo "2. Testing with UNDERSCORE (D8s_v4) - Should return 20+ results:"
curl -s 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20%27eastus%27%20and%20contains(serviceName,%20%27Virtual%20Machines%27)%20and%20contains(armSkuName,%20%27D8s_v4%27)%20and%20priceType%20eq%20%27Consumption%27' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'Count: {len(data.get(\"Items\", []))}'); items=data.get('Items', []); print(f'First item: {items[0][\"armSkuName\"]} @ ${items[0][\"retailPrice\"]}/hour' if items else 'No items')"

echo ""
echo "3. Testing without version (D8s) - Should return results:"
curl -s 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20%27eastus%27%20and%20contains(serviceName,%20%27Virtual%20Machines%27)%20and%20contains(armSkuName,%20%27D8s%27)%20and%20priceType%20eq%20%27Consumption%27' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'Count: {len(data.get(\"Items\", []))}'); items=data.get('Items', []); skus=set(item['armSkuName'] for item in items if 'D8s' in item['armSkuName']); print(f'Sample SKUs: {list(skus)[:5]}')"

echo ""
echo "=== Region name tests ==="
echo ""

echo "4. Testing westus2 (lowercase, no space):"
curl -s 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20%27westus2%27%20and%20contains(serviceName,%20%27Virtual%20Machines%27)%20and%20contains(armSkuName,%20%27D8s_v4%27)%20and%20priceType%20eq%20%27Consumption%27' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'Count: {len(data.get(\"Items\", []))}')"

echo ""
echo "5. Testing northcentralus (lowercase, no space):"
curl -s 'https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview&$filter=armRegionName%20eq%20%27northcentralus%27%20and%20contains(serviceName,%20%27Virtual%20Machines%27)%20and%20contains(armSkuName,%20%27D8s_v4%27)%20and%20priceType%20eq%20%27Consumption%27' | python3 -c "import sys, json; data=json.load(sys.stdin); print(f'Count: {len(data.get(\"Items\", []))}')"

echo ""
echo "=== Tests complete ==="
