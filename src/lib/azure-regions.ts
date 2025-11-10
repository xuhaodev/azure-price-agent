// 完整的 Azure 区域映射 - 包含所有可用区域
// 格式: "code|display" 节省空间
const regionMap = `australiacentral|Australia Central
australiacentral2|Australia Central 2
australiaeast|Australia East
australiasoutheast|Australia Southeast
austriaeast|Austria East
belgiumcentral|Belgium Central
brazilsouth|Brazil South
brazilsoutheast|Brazil Southeast
canadacentral|Canada Central
canadaeast|Canada East
centralindia|Central India
centralus|Central US
chilecentral|Chile Central
eastasia|East Asia
eastus|East US
eastus2|East US 2
francecentral|France Central
francesouth|France South
germanynorth|Germany North
germanywestcentral|Germany West Central
indonesiacentral|Indonesia Central
israelcentral|Israel Central
italynorth|Italy North
japaneast|Japan East
japanwest|Japan West
koreacentral|Korea Central
koreasouth|Korea South
malaysiawest|Malaysia West
mexicocentral|Mexico Central
newzealandnorth|New Zealand North
northcentralus|North Central US
northeurope|North Europe
norwayeast|Norway East
norwaywest|Norway West
polandcentral|Poland Central
qatarcentral|Qatar Central
southafricanorth|South Africa North
southafricawest|South Africa West
southcentralus|South Central US
southindia|South India
southeastasia|Southeast Asia
spaincentral|Spain Central
swedencentral|Sweden Central
swedensouth|Sweden South
switzerlandnorth|Switzerland North
switzerlandwest|Switzerland West
uaecentral|UAE Central
uaenorth|UAE North
uksouth|UK South
ukwest|UK West
westcentralus|West Central US
westeurope|West Europe
westindia|West India
westus|West US
westus2|West US 2
westus3|West US 3`;

// 懒加载解析映射表
let cachedRegions: Record<string, string> | null = null;

function getRegionMap(): Record<string, string> {
  if (!cachedRegions) {
    cachedRegions = {};
    regionMap.split('\n').forEach(line => {
      const [code, name] = line.split('|');
      cachedRegions![code] = name;
    });
  }
  return cachedRegions;
}

export const azureRegions = new Proxy({} as Record<string, string>, {
  get: (_, prop: string) => getRegionMap()[prop]
});

/**
 * 获取区域的显示名称
 */
export function getRegionDisplayName(regionCode: string): string {
  if (!regionCode) return "Unknown";
  return getRegionMap()[regionCode.toLowerCase()] || regionCode;
}

/**
 * 根据显示名称获取区域代码
 */
export function getRegionCode(displayName: string): string {
  if (!displayName) return "unknown";
  
  const map = getRegionMap();
  const normalized = displayName.toLowerCase();
  
  for (const [code, name] of Object.entries(map)) {
    if (name.toLowerCase() === normalized) {
      return code;
    }
  }
  
  return displayName;
}