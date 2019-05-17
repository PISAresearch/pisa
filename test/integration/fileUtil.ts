import fs from "fs";
import path from "path";

export class FileUtils {
    private static *walkFilesAndDirsSync(
        dir: string
    ): IterableIterator<{
        isDirectory: boolean;
        path: string;
    }> {
        const files = fs.readdirSync(dir);

        for (const file of files) {
            const pathToFile = path.join(dir, file);
            const isDirectory = fs.statSync(pathToFile).isDirectory();
            if (isDirectory) {
                yield* this.walkFilesAndDirsSync(pathToFile);
                // yield the directory after all it's internal files
                yield { isDirectory: true, path: pathToFile };
            } else {
                yield { isDirectory: false, path: pathToFile };
            }
        }
    }

    public static rmRfDirSync(dirPath: string) {
        if (!fs.existsSync(dirPath)) return;

        for (const p of this.walkFilesAndDirsSync(dirPath)) {
            if (p.isDirectory) {
                fs.rmdirSync(p.path);
            } else {
                fs.unlinkSync(p.path);
            }
        }

        fs.rmdirSync(dirPath);
    }

    public static touchFileSync(filePath: string) {
        fs.closeSync(fs.openSync(filePath, "w"));
    }
}
