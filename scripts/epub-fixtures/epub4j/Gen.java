// 照 so-novel 的 EpubMergeHandler 生成 EPUB：封面图 + 封面页 + 数字 id 的章节页 + guide 封面引用
// 用法：java -cp "deps/*" Gen.java <book.json> <cover.jpg> <输出.epub>
import io.documentnode.epub4j.domain.*;
import io.documentnode.epub4j.epub.EpubWriter;

import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class Gen {
  // book.json 结构固定，用正则取字段，免去 JSON 库依赖
  static String field(String json, String name) {
    Matcher m = Pattern.compile("\"" + name + "\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(json);
    return m.find() ? m.group(1) : "";
  }

  public static void main(String[] args) throws Exception {
    String json = Files.readString(Path.of(args[0]), StandardCharsets.UTF_8);
    byte[] cover = Files.readAllBytes(Path.of(args[1]));
    String coverPage = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">\n"
        + "<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"zh\"><head><title>封面</title></head>"
        + "<body><div><img src=\"cover.jpg\" alt=\"封面图片\"/></div></body></html>";

    Book book = new Book();
    Metadata meta = book.getMetadata();
    meta.addTitle(field(json, "title"));
    meta.setAuthors(List.of(new Author(field(json, "author"))));
    meta.addDescription(field(json, "description"));
    book.setCoverImage(new Resource(cover, "cover.jpg"));
    book.addSection("封面", new Resource(coverPage.getBytes(StandardCharsets.UTF_8), "cover.html"));
    meta.setLanguage("zh");
    meta.addPublisher("so-novel");

    // 章节：title + paragraphs 数组
    Matcher ch = Pattern.compile("\"title\"\\s*:\\s*\"([^\"]+)\"\\s*,\\s*\"marker\"[^\\[]*\\[([^\\]]*)\\]").matcher(json);
    List<String[]> chapters = new ArrayList<>();
    while (ch.find()) chapters.add(new String[]{ch.group(1), ch.group(2)});
    int len = String.valueOf(chapters.size()).length();
    for (int i = 0; i < chapters.size(); i++) {
      String title = chapters.get(i)[0];
      StringBuilder body = new StringBuilder();
      Matcher p = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"").matcher(chapters.get(i)[1]);
      while (p.find()) body.append("<p>").append(p.group(1)).append("</p>\n");
      String html = "<?xml version=\"1.0\" encoding=\"UTF-8\" ?>\n<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.1//EN\" \"http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd\">\n"
          + "<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"zh\"><head>"
          + "<meta http-equiv=\"Content-Type\" content=\"application/xhtml+xml; charset=utf-8\" /><title>" + title + "</title></head>"
          + "<body><h2>" + title + "</h2><div>" + body + "</div></body></html>";
      String id = String.format("%0" + len + "d", i + 1);
      book.addSection(title, new Resource(id, html.getBytes(StandardCharsets.UTF_8), id + ".html", MediaTypes.XHTML));
    }
    book.getGuide().addReference(new GuideReference(new Resource(coverPage.getBytes(StandardCharsets.UTF_8), "cover.html"), "封面", "cover.html"));
    try (FileOutputStream out = new FileOutputStream(args[2])) {
      new EpubWriter().write(book, out);
    }
  }
}
