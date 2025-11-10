// 精简的 Azure VM 类型映射 - 仅保留核心信息,大幅降低 token 消耗
// 格式: Type|Family|Keywords|Example
export const azureVmSize = [
  { type: "General", family: "A", keywords: "economical, entry-level, balanced", example: "Standard_A1_v2" },
  { type: "General", family: "B", keywords: "burstable, credits, variable", example: "Standard_B1s" },
  { type: "General", family: "D", keywords: "enterprise, databases, caching", example: "Standard_D2_v5" },
  { type: "General", family: "DC", keywords: "confidential, security, TEE", example: "Standard_DC2s_v3" },
  { type: "Compute", family: "F", keywords: "compute-intensive, high CPU, batch", example: "Standard_F2s_v2" },
  { type: "Compute", family: "FX", keywords: "EDA, large memory, high frequency", example: "Standard_FX4mds" },
  { type: "Memory", family: "E", keywords: "memory-intensive, high memory, caches", example: "Standard_E2_v5" },
  { type: "Memory", family: "Eb", keywords: "remote storage, high performance", example: "Standard_Eb4s_v5" },
  { type: "Memory", family: "EC", keywords: "confidential, memory-intensive", example: "Standard_EC2s_v5" },
  { type: "Memory", family: "M", keywords: "ultra-high memory, large databases", example: "Standard_M128ms" },
  { type: "Storage", family: "L", keywords: "storage-intensive, high throughput, big data", example: "Standard_L8s_v3" },
  { type: "GPU", family: "NC", keywords: "GPU, NVIDIA, visualization", example: "Standard_NC6" },
  { type: "GPU", family: "ND", keywords: "deep learning, AI, large memory", example: "Standard_ND40rs_v2" },
  { type: "GPU", family: "NG", keywords: "gaming, VDI, AMD Radeon", example: "Standard_NG32ads_V620_v1" },
  { type: "GPU", family: "NV", keywords: "graphics, rendering, NVIDIA", example: "Standard_NV6" },
  { type: "FPGA", family: "NP", keywords: "FPGA, inference, transcoding", example: "Standard_NP10s" },
  { type: "HPC", family: "HB", keywords: "HPC, high bandwidth, weather", example: "Standard_HB120rs_v2" },
  { type: "HPC", family: "HC", keywords: "finite element, molecular dynamics", example: "Standard_HC44rs" },
  { type: "HPC", family: "HX", keywords: "large memory, EDA, high performance", example: "Standard_HX176rs" }
];
