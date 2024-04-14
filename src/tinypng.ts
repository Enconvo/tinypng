import { existsSync } from "fs";
import { mkdirSync } from "fs";
import { statSync, createReadStream, createWriteStream } from "fs";
import fetch from "node-fetch";
import { dirname, basename, join } from "path";
import { compressImageResponseScheme } from "zodSchema.ts";
import { resolveOutputPath } from "lib/utils.ts";
import { uuid, res, ChatMessage, ActionProps, Action, Attachment, MessageContent, CoreDataChatHistory } from '@enconvo/api'
import { mapOpenaiToLangChain } from "@enconvo/api";

const chatHistory = new CoreDataChatHistory()


export default async function main(req: Request) {

  const { options } = await req.json();

  const filePaths: string[] = (options.contextFiles || [])

  let images: MessageContent[] = []
  filePaths.forEach((filePath) => {

    images.push({
      type: "image_url",
      image_url: {
        url: `file://${filePath}`
      },
    });

  })

  const requestId = uuid()

  await Attachment.clearAttachments()

  const storeMessage = {
    role: "user",
    content: images
  }

  await chatHistory.addMultiModalMessage({
    message: storeMessage,
    customId: requestId
  })

  const contextMessage = storeMessage
  const lcContextMessage = mapOpenaiToLangChain(contextMessage)
  // add id to context message
  lcContextMessage.id = requestId
  await res.context(lcContextMessage)

  const results = await Promise.all(filePaths.map((filePath) => _compressImage(filePath, options)));
  const totalOriginalSize = results.reduce((acc, cur) => acc + cur[0].originalSize, 0);
  const totalCompressedSize = results.reduce((acc, cur) => acc + cur[0].compressedSize, 0);


  const message: ChatMessage = {
    role: "ai",
    content: [
      {
        type: "text",
        text: "Compression successful 🎉  (-" + (100 - (totalCompressedSize / totalOriginalSize) * 100).toFixed(1) + "%)"
      }
    ]
  }


  let imagePaths: string[] = []

  results.forEach((result) => {
    result.forEach((image) => {
      imagePaths.push(image.outputPath)
      message.content.push({
        type: "image_url",
        image_url: {
          url: `file://${image.outputPath}`
        },
      });
    });
  });

  await chatHistory.addLCMultiModalMessage({
    message: message,
    replyToId: requestId
  })

  const actions: ActionProps[] = [
    Action.Paste({ files: imagePaths }, true),
    Action.Copy({ files: imagePaths })
  ]

  await Attachment.showAttachments([])

  return {
    type: "messages",
    messages: [message],
    actions: actions
  }


}

const _compressImage = async (
  filePath: string,
  preferences: any
): Promise<
  [
    {
      originalSize: number;
      compressedSize: number;
      outputPath: string;
    }
  ]
> => {
  const { size } = statSync(filePath);

  const readStream = createReadStream(filePath);

  res.write({
    content: "Uploading image...",
    overwrite: true
  })
  // Upload original image
  const resPost = await fetch("https://api.tinify.com/shrink", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${preferences.apiKey}`).toString("base64")}`,
      contentLength: size.toString(),
    },
    body: readStream,
  });

  const resJson = compressImageResponseScheme.parse(await resPost.json());

  // Validate
  if ("error" in resJson) {
    throw new Error(resJson.message);
  }

  res.write({
    content: "Upload Successful! Compressing...",
    overwrite: true
  })

  // Download compressed image
  const downloadUrl = resJson.output.url;
  const resGet = await fetch(downloadUrl);

  // Save compressed image
  let outputDir = dirname(filePath);
  console.log('preferences', preferences)
  if (preferences.overwrite === 'false') {
    outputDir = resolveOutputPath(filePath, preferences.destinationFolderPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir);
    }
  }

  // The total number of bytes of the file 
  const totalSize = resGet.headers.get('Content-Length');
  console.log('totalSize', totalSize)

  const outputPath = join(outputDir, basename(filePath));
  const outputFileStream = createWriteStream(outputPath);

  await new Promise((resolve, reject) => {
    resGet.body?.pipe(outputFileStream);
    resGet.body?.on("error", reject);
    outputFileStream.on("finish", resolve);
  });

  return [
    {
      originalSize: size,
      compressedSize: resJson.output.size,
      outputPath
    },
  ];
};
