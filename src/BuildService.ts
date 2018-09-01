import * as logdown from 'logdown';
import * as JSZip from 'jszip';
import * as path from 'path';
import * as progress from 'progress';
import {CLIOptions, Entry} from './Interfaces';
import {fsPromise, FileService} from './FileService';

class BuildService {
  private readonly fileService: FileService;
  private readonly jszip: JSZip;
  private readonly logger: logdown.Logger;
  private readonly options: Required<CLIOptions>;
  private readonly progressBar: progress;
  private entries: Entry[];
  private ignoreEntries: RegExp[];
  public outputFile: string | null;
  public zippedFilesCount: number;

  constructor(options: Required<CLIOptions>) {
    this.fileService = new FileService(options);
    this.jszip = new JSZip();
    this.options = options;
    this.logger = logdown('jszip-cli/BuildService', {
      logger: console,
      markdown: false,
    });
    this.logger.state = {isEnabled: options.verbose};
    this.entries = [];
    this.ignoreEntries = this.options.ignoreEntries.map(entry => new RegExp(entry.replace('*', '.*')));
    this.outputFile = this.options.outputEntry ? path.resolve(this.options.outputEntry) : null;
    this.progressBar = new progress('Compressing [:bar] :percent :elapseds', {
      complete: '=',
      incomplete: ' ',
      total: 100,
      width: 20,
    });
    this.zippedFilesCount = 0;
  }

  public add(rawEntries: string[]): BuildService {
    this.logger.info(`Adding ${rawEntries.length} entr${rawEntries.length === 1 ? 'y' : 'ies'} to ZIP file.`);
    this.entries = rawEntries.map(rawEntry => {
      const resolvedPath = path.resolve(rawEntry);
      const baseName = path.basename(rawEntry);
      return {
        resolvedPath,
        zipPath: baseName,
      };
    });
    return this;
  }

  public getBuffer(): Promise<Buffer> {
    let lastPercent = 0;
    const compressionType = this.options.compressionLevel === 0 ? 'STORE' : 'DEFLATE';

    return this.jszip.generateAsync(
      {
        type: 'nodebuffer',
        compression: compressionType,
        compressionOptions: {
          level: this.options.compressionLevel,
        },
      },
      ({percent}) => {
        this.zippedFilesCount++;
        const diff = Math.floor(percent) - Math.floor(lastPercent);
        if (diff && !this.options.quiet) {
          this.progressBar.tick(diff);
          lastPercent = Math.floor(percent);
        }
      }
    );
  }

  public async save(): Promise<BuildService> {
    await this.checkOutput();

    await Promise.all(this.entries.map(entry => this.checkEntry(entry)));
    const data = await this.getBuffer();

    if (this.outputFile) {
      if (!this.outputFile.match(/\.\w+$/)) {
        this.outputFile = path.join(this.outputFile, 'data.zip');
      }

      await this.fileService.writeFile(data, this.outputFile);
    } else {
      process.stdout.write(data);
    }

    return this;
  }

  private async addFile(entry: Entry): Promise<void> {
    const {resolvedPath, zipPath} = entry;
    const fileData = await fsPromise.readFile(resolvedPath);
    const fileStat = await fsPromise.lstat(resolvedPath);

    await this.jszip.file(zipPath, fileData, {
      createFolders: true,
      date: fileStat.mtime,
      //dosPermissions: fileStat.mode,
      unixPermissions: fileStat.mode,
    });
  }

  private async addLink(entry: Entry): Promise<void> {
    const {resolvedPath, zipPath} = entry;
    const fileData = await fsPromise.readLink(resolvedPath);
    const fileStat = await fsPromise.lstat(resolvedPath);

    await this.jszip.file(zipPath, fileData, {
      date: fileStat.mtime,
      createFolders: true,
      //dosPermissions: fileStat.mode,
      unixPermissions: fileStat.mode,
    });
  }

  private async checkEntry(entry: Entry): Promise<void> {
    const fileStat = await fsPromise.lstat(entry.resolvedPath);
    const ignoreEntries = this.ignoreEntries.filter(ignoreEntry => Boolean(entry.resolvedPath.match(ignoreEntry)));

    if (ignoreEntries.length) {
      this.logger.info(
        `Found ${entry.resolvedPath}. Not adding since it's on the ignore list:`,
        ignoreEntries.map(entry => String(entry))
      );
      return;
    }

    this.logger.info(`Found ${entry.resolvedPath}. Adding to the ZIP file.`);

    if (fileStat.isDirectory()) {
      await this.walkDir(entry);
    } else if (fileStat.isFile()) {
      await this.addFile(entry);
    } else if (fileStat.isSymbolicLink()) {
      await this.addLink(entry);
    } else {
      this.logger.info(`Unknown file type.`, {fileStat});
      console.info(`Can't read: ${entry.resolvedPath}. Ignoring.`);
    }
  }

  private async checkOutput(): Promise<void> {
    if (this.outputFile) {
      if (this.outputFile.match(/\.\w+$/)) {
        const dirExists = await this.fileService.dirExists(path.dirname(this.outputFile));

        if (!dirExists) {
          throw new Error(`Directory "${path.dirname(this.outputFile)}" doesn't exist or is not writable.`);
        }

        const fileIsWritable = await this.fileService.fileIsWritable(this.outputFile);
        if (!fileIsWritable) {
          throw new Error(`File "${this.outputFile}" already exists.`);
        }
      } else {
        const dirExists = await this.fileService.dirExists(this.outputFile);

        if (!dirExists) {
          throw new Error(`Directory "${this.outputFile}" doesn't exist or is not writable.`);
        }
      }
    }
  }

  private async walkDir(entry: Entry): Promise<void> {
    this.logger.info(`Walking directory ${entry.resolvedPath} ...`);
    const files = await fsPromise.readDir(entry.resolvedPath);
    for (const file of files) {
      const newZipPath = entry.zipPath + '/' + file;
      const newResolvedPath = path.join(entry.resolvedPath, file);
      await this.checkEntry({
        resolvedPath: newResolvedPath,
        zipPath: newZipPath,
      });
    }
  }
}

export {BuildService};
