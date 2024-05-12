import { dirname, join, isAbsolute } from "path";
import { homedir } from "os";

export const resolveOutputPath = (filePath: string, destinationFolderPath: string) => {
  const expandedDestinationFolderPath = destinationFolderPath.replace(/^~($|\/|\\)/, `${homedir()}/`);

  if (isAbsolute(expandedDestinationFolderPath)) {
    return expandedDestinationFolderPath;
  } else {
    return join(dirname(filePath), expandedDestinationFolderPath);
  }
};


// 判断是arm 还是 x86
export const isARM = process.arch === 'arm' || process.arch === 'arm64';
export const isX86 = process.arch === 'x64' || process.arch === 'ia32';
