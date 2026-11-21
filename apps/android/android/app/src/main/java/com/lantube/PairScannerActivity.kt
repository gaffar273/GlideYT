package com.lantube

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.ViewfinderView

class PairScannerActivity : CaptureActivity() {
    override fun initializeContent(): DecoratedBarcodeView {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.pair_scanner)
        val controls = findViewById<View>(R.id.scanner_controls)
        val margin = controls.paddingLeft
        ViewCompat.setOnApplyWindowInsetsListener(controls) { view, insets ->
            val edges = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(margin + edges.left, margin + edges.top, margin + edges.right, margin + edges.bottom)
            insets
        }
        findViewById<View>(R.id.close_scanner).setOnClickListener { finish() }
        return findViewById(R.id.pair_camera)
    }
}

class PairViewfinder(context: Context, attrs: AttributeSet) : ViewfinderView(context, attrs) {
    private val density = resources.displayMetrics.density
    private val mask = Path()
    private val corner = Path().apply {
        moveTo(0f, 32f)
        lineTo(0f, 16f)
        quadTo(0f, 0f, 16f, 0f)
        lineTo(32f, 0f)
    }
    private val shade = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xB3141C18.toInt() }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF54EB87.toInt()
        style = Paint.Style.STROKE
        strokeWidth = 4f
        strokeCap = Paint.Cap.ROUND
    }

    override fun onDraw(canvas: Canvas) {
        refreshSizes()
        val frame = framingRect ?: return
        val left = frame.left.toFloat()
        val top = frame.top.toFloat()
        val right = frame.right.toFloat()
        val bottom = frame.bottom.toFloat()
        val radius = 16f * density
        mask.rewind()
        mask.fillType = Path.FillType.EVEN_ODD
        mask.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
        mask.addRoundRect(left, top, right, bottom, radius, radius, Path.Direction.CW)
        canvas.drawPath(mask, shade)
        drawCorner(canvas, left, top, density, density)
        drawCorner(canvas, right, top, -density, density)
        drawCorner(canvas, right, bottom, -density, -density)
        drawCorner(canvas, left, bottom, density, -density)
    }

    private fun drawCorner(canvas: Canvas, x: Float, y: Float, scaleX: Float, scaleY: Float) {
        canvas.save()
        canvas.translate(x, y)
        canvas.scale(scaleX, scaleY)
        canvas.drawPath(corner, stroke)
        canvas.restore()
    }
}
