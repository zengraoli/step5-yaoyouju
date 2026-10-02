package com.yaoyouju.android.ui.screens

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.os.Environment
import androidx.core.content.FileProvider
import java.io.File

/**
 * 复诊摘要导出（Android 端真实生成文件，不只说「由浏览器打印生成」）。
 * - 文本：.txt（带头部与水印脚注，服务端返回的纯文本）
 * - PDF：用 PdfDocument 真实渲染成 .pdf（用户可在文件管理器查看 / 分享）
 * - 图片：把摘要渲染成 .png
 * 文件统一放在 Download/Yaoyouju，通过 FileProvider 分享（不暴露 file:// URI）。
 */
object ExportFiles {

    fun exportText(context: Context, text: String): File {
        val file = newFile("txt")
        file.writeText(text)
        return file
    }

    fun exportPdf(context: Context, text: String): File {
        val file = newFile("pdf")
        val document = PdfDocument()
        val pageWidth = 595 // A4 @72dpi
        val pageHeight = 842
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 11f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        val margin = 36f
        val maxWidth = pageWidth - margin * 2
        var pageNumber = 1
        var page: PdfDocument.Page = document.startPage(
            PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create(),
        )
        var canvas: Canvas = page.canvas
        var y = margin + paint.textSize
        fun newPage() {
            document.finishPage(page)
            pageNumber += 1
            page = document.startPage(
                PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create(),
            )
            canvas = page.canvas
            y = margin + paint.textSize
        }
        for (rawLine in text.split("\n")) {
            val line = rawLine.ifBlank { " " }
            // 简单按宽度折行（中文按字宽估算）
            var rest = line
            while (rest.isNotEmpty()) {
                val count = paint.breakText(rest, true, maxWidth, null)
                val chunk = rest.substring(0, count)
                if (y > pageHeight - margin) newPage()
                canvas.drawText(chunk, margin, y, paint)
                y += paint.textSize * 1.5f
                rest = rest.substring(count)
            }
        }
        document.finishPage(page)
        file.outputStream().use { out -> document.writeTo(out) }
        document.close()
        return file
    }

    fun exportImage(context: Context, text: String): File {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 26f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        val width = 1080
        val padding = 48f
        val maxWidth = width - padding * 2
        val lines = mutableListOf<String>()
        for (rawLine in text.split("\n")) {
            var rest = rawLine.ifBlank { " " }
            while (rest.isNotEmpty()) {
                val count = paint.breakText(rest, true, maxWidth, null)
                lines.add(rest.substring(0, count))
                rest = rest.substring(count)
            }
        }
        val lineHeight = paint.textSize * 1.6f
        val height = (padding * 2 + lines.size * lineHeight).toInt().coerceAtLeast(400)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)
        var y = padding + paint.textSize
        lines.forEach {
            canvas.drawText(it, padding, y, paint)
            y += lineHeight
        }
        val file = newFile("png")
        file.outputStream().use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        return file
    }

    fun share(context: Context, file: File, mime: String) {
        val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mime
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "腰有据 · 就诊交接摘要")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(Intent.createChooser(intent, "分享复诊摘要"))
    }

    private fun newFile(ext: String): File {
        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            "Yaoyouju",
        )
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "yaoyouju-followup-${System.currentTimeMillis()}.$ext")
    }
}
