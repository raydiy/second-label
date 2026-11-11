// Lucide UI icons (ISC). Imported individually so the toolbar does not need the full sprite.
import i_type from 'lucide-static/icons/type.svg?raw';
import i_minus from 'lucide-static/icons/minus.svg?raw';
import i_square from 'lucide-static/icons/square.svg?raw';
import i_circle from 'lucide-static/icons/circle.svg?raw';
import i_image from 'lucide-static/icons/image.svg?raw';
import i_shapes from 'lucide-static/icons/shapes.svg?raw';
import i_barcode from 'lucide-static/icons/barcode.svg?raw';
import i_undo_2 from 'lucide-static/icons/undo-2.svg?raw';
import i_redo_2 from 'lucide-static/icons/redo-2.svg?raw';
import i_zoom_in from 'lucide-static/icons/zoom-in.svg?raw';
import i_zoom_out from 'lucide-static/icons/zoom-out.svg?raw';
import i_scan from 'lucide-static/icons/scan.svg?raw';
import i_save from 'lucide-static/icons/save.svg?raw';
import i_save_all from 'lucide-static/icons/save-all.svg?raw';
import i_file_plus from 'lucide-static/icons/file-plus.svg?raw';
import i_upload from 'lucide-static/icons/upload.svg?raw';
import i_download from 'lucide-static/icons/download.svg?raw';
import i_printer from 'lucide-static/icons/printer.svg?raw';
import i_eye from 'lucide-static/icons/eye.svg?raw';
import i_usb from 'lucide-static/icons/usb.svg?raw';
import i_trash_2 from 'lucide-static/icons/trash-2.svg?raw';
import i_copy from 'lucide-static/icons/copy.svg?raw';
import i_align_start_vertical from 'lucide-static/icons/align-start-vertical.svg?raw';
import i_align_center_vertical from 'lucide-static/icons/align-center-vertical.svg?raw';
import i_align_end_vertical from 'lucide-static/icons/align-end-vertical.svg?raw';
import i_align_start_horizontal from 'lucide-static/icons/align-start-horizontal.svg?raw';
import i_align_center_horizontal from 'lucide-static/icons/align-center-horizontal.svg?raw';
import i_align_end_horizontal from 'lucide-static/icons/align-end-horizontal.svg?raw';
import i_bring_to_front from 'lucide-static/icons/bring-to-front.svg?raw';
import i_send_to_back from 'lucide-static/icons/send-to-back.svg?raw';
import i_arrow_up from 'lucide-static/icons/arrow-up.svg?raw';
import i_arrow_down from 'lucide-static/icons/arrow-down.svg?raw';
import i_bold from 'lucide-static/icons/bold.svg?raw';
import i_italic from 'lucide-static/icons/italic.svg?raw';
import i_underline from 'lucide-static/icons/underline.svg?raw';
import i_align_left from 'lucide-static/icons/align-left.svg?raw';
import i_align_center from 'lucide-static/icons/align-center.svg?raw';
import i_align_right from 'lucide-static/icons/align-right.svg?raw';
import i_folder_open from 'lucide-static/icons/folder-open.svg?raw';
import i_pencil from 'lucide-static/icons/pencil.svg?raw';
import i_plug from 'lucide-static/icons/plug.svg?raw';
import i_unplug from 'lucide-static/icons/unplug.svg?raw';

const ICONS: Record<string, string> = {
  'type': i_type,
  'minus': i_minus,
  'square': i_square,
  'circle': i_circle,
  'image': i_image,
  'shapes': i_shapes,
  'barcode': i_barcode,
  'undo-2': i_undo_2,
  'redo-2': i_redo_2,
  'zoom-in': i_zoom_in,
  'zoom-out': i_zoom_out,
  'scan': i_scan,
  'save': i_save,
  'save-all': i_save_all,
  'file-plus': i_file_plus,
  'upload': i_upload,
  'download': i_download,
  'printer': i_printer,
  'eye': i_eye,
  'usb': i_usb,
  'trash-2': i_trash_2,
  'copy': i_copy,
  'align-start-vertical': i_align_start_vertical,
  'align-center-vertical': i_align_center_vertical,
  'align-end-vertical': i_align_end_vertical,
  'align-start-horizontal': i_align_start_horizontal,
  'align-center-horizontal': i_align_center_horizontal,
  'align-end-horizontal': i_align_end_horizontal,
  'bring-to-front': i_bring_to_front,
  'send-to-back': i_send_to_back,
  'arrow-up': i_arrow_up,
  'arrow-down': i_arrow_down,
  'bold': i_bold,
  'italic': i_italic,
  'underline': i_underline,
  'align-left': i_align_left,
  'align-center': i_align_center,
  'align-right': i_align_right,
  'folder-open': i_folder_open,
  'pencil': i_pencil,
  'plug': i_plug,
  'unplug': i_unplug,
};

/** Returns inline SVG markup for a UI icon (decorative, aria-hidden). */
export function icon(name: string, size = 16): string {
  const raw = ICONS[name];
  if (!raw) return "";
  return raw
    .replace(/<!--.*?-->/s, "")
    .replace(/width="24"/, `width="${size}"`)
    .replace(/height="24"/, `height="${size}" aria-hidden="true" focusable="false"`)
    .trim();
}
